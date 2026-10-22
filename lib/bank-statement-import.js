import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import '../src/shared/finance-core.js';

const F=globalThis.FinanceCore;
const reject=message=>{throw Object.assign(Error(message),{code:'BANK_IMPORT_INVALID'});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const cents=value=>Math.round(value*100);
const equal=(a,b,message)=>{if(!isDeepStrictEqual(a,b))reject(message);};

export function parseCsv(text){
 if(typeof text!=='string')reject('Arquivo CSV inválido.');
 const rows=[];let row=[],value='',quoted=false,closed=false;
 text=text.replace(/^\uFEFF/,'');
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(quoted){if(char==='"'){if(text[index+1]==='"'){value+='"';index++;}else{quoted=false;closed=true;}}else value+=char;continue;}
  if(char==='"'){if(value||closed)reject('Aspas inválidas no CSV.');quoted=true;continue;}
  if(char===','||char==='\n'||char==='\r'){
   row.push(value);value='';closed=false;
   if(char!==','){if(row.some(field=>field!==''))rows.push(row);row=[];if(char==='\r'&&text[index+1]==='\n')index++;}
  }else{if(closed)reject('Texto inválido depois das aspas do CSV.');value+=char;}
 }
 if(quoted)reject('Campo CSV não foi fechado.');
 row.push(value);if(row.some(field=>field!==''))rows.push(row);
 const header=rows.shift();if(!header||new Set(header).size!==header.length)reject('Cabeçalho CSV inválido.');
 return {header,rows:rows.map((fields,index)=>{if(fields.length!==header.length)reject('Quantidade de colunas inválida na linha '+(index+2)+'.');return Object.fromEntries(header.map((name,index)=>[name,fields[index]]));})};
}
function parseAmount(value,brazilian=false){
 if(typeof value!=='string')reject('Valor CSV inválido.');
 const normalized=brazilian?value.replace(/\s/g,'').replace(/\./g,'').replace(',','.'):value.trim();
 if(!/^-?\d+\.\d{2}$/.test(normalized))reject('Valor CSV inválido.');
 const negative=normalized.startsWith('-'),[whole,fraction]=normalized.replace('-','').split('.');
 const result=Number(BigInt(whole)*100n+BigInt(fraction))*(negative?-1:1);
 if(!Number.isSafeInteger(result)||Math.abs(result)>10_000_000_000)reject('Valor CSV fora do limite.');
 return result;
}
function isoDate(value,brazilian=false){
 if(brazilian){if(!/^\d{2}\/\d{2}\/\d{4}$/.test(value))reject('Data CSV inválida.');value=value.split('/').reverse().join('-');}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)reject('Data CSV inválida.');
 return value;
}
export function statementCategory(description){
 const name=description.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/farmacia|drogaria|medicamento/.test(name))return 'Saúde';
 if(/super center|hipermercado|atacad|\bkoch\b|casa de carnes/.test(name))return 'Mercado';
 if(/posto|disk pecas/.test(name))return 'Transporte';
 if(/prefeitura|\biof\b/.test(name))return 'Impostos e taxas';
 if(/restaurante|pizza|panificadora|hao yun|jagerhaus/.test(name))return 'Alimentação';
 if(/spotify|youtub|strike park/.test(name))return 'Lazer';
 if(/google|openai|hostinger/.test(name))return 'Internet / telefone';
 if(/milium/.test(name))return 'Manutenção';
 return 'Outros';
}
export function readBankStatements({debitCsv,creditCsv,month,invoiceDueDate}){
 invoiceDueDate=isoDate(invoiceDueDate);
 if(!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))reject('Mês do extrato inválido.');
 const bank=parseCsv(debitCsv),credit=parseCsv(creditCsv);
 equal(bank.header,['Data','Valor','Identificador','Descrição'],'Formato do extrato de débito não reconhecido.');
 equal(credit.header,['date','title','amount'],'Formato da fatura não reconhecido.');
 const ids=new Set(),debits=[];
 for(const row of bank.rows){
  const date=isoDate(row.Data,true),amount=parseAmount(row.Valor);
  if(date.slice(0,7)!==month)reject('Há lançamentos fora do mês do extrato.');
  if(!row.Identificador||ids.has(row.Identificador))reject('Identificador bancário ausente ou duplicado.');
  ids.add(row.Identificador);
  if(!row.Descrição.startsWith('Compra no débito - '))continue;
  if(amount>=0)reject('Uma compra no débito tem sinal inválido.');
  const description=row.Descrição.slice('Compra no débito - '.length).trim();
  if(!description||description.length>500)reject('Descrição de compra inválida.');
  debits.push({id:'bank:nubank:'+row.Identificador,type:'expense',description,category:statementCategory(description),amount:-amount/100,date,method:'Débito',paymentMethod:'debit',purchaseDate:date});
 }
 const invoiceMonth=invoiceDueDate.slice(0,7),occurrences=new Map(),purchases=[];
 let ignoredCreditPayments=0;
 for(const row of credit.rows){
  const date=isoDate(row.date),amount=parseAmount(row.amount,true),title=row.title.trim();
  if(amount<0&&/^Pagamento recebido$/i.test(title)){ignoredCreditPayments++;continue;}
  if(amount<=0||!title||title.length>500||date.slice(0,7)>invoiceMonth)reject('Item de fatura inválido. Reembolsos exigem conciliação separada.');
  const fingerprint=JSON.stringify([date,title,amount]),occurrence=(occurrences.get(fingerprint)||0)+1;occurrences.set(fingerprint,occurrence);
  purchases.push({id:'statement:nubank:'+invoiceMonth+':'+digest(fingerprint+':'+occurrence).slice(0,32),cardId:'nubank',description:title,category:statementCategory(title),purchaseDate:date,amount:amount/100,items:[{name:title,qty:1,unit:amount/100}],installments:[{date:invoiceMonth+'-01',amount:amount/100,installmentNumber:1,installmentCount:1}]});
 }
 if(!debits.length||!purchases.length)reject('Os arquivos precisam conter compras no débito e itens da fatura.');
 return {month,invoiceMonth,invoiceDueDate,debits,purchases,debitTotal:debits.reduce((sum,row)=>sum+cents(row.amount),0)/100,creditTotal:purchases.reduce((sum,row)=>sum+cents(row.amount),0)/100,ignoredBankRows:bank.rows.length-debits.length,ignoredCreditPayments,sourceHashes:{debit:digest(debitCsv),credit:digest(creditCsv)}};
}
export function prepareBankStatementImport(previous,input){
 if(input.username!=='jefferson')reject('Esta conciliação se destina à conta pessoal do Jefferson.');
 const asOf=isoDate(input.asOf),statement=readBankStatements(input);
 if(!F.validateFinance(previous))reject('Os dados financeiros existentes são inválidos.');
 if(statement.debits.some(row=>row.date>asOf))reject('Há compras de débito posteriores à data da conciliação.');
 const importId='nubank-statements:'+statement.month+':'+statement.invoiceMonth,existing=previous.finance?.bankStatementImports?.find(row=>row.id===importId);
 const balanceBefore=F.currentBalance(structuredClone(previous),asOf);
 if(existing){
  equal(existing.sourceHashes,statement.sourceHashes,'Esse período já foi importado com arquivos diferentes. Confira a conciliação existente.');
  for(const row of statement.debits)equal(previous.transactions.find(item=>item.id===row.id),row,'Uma compra importada foi alterada ou excluída. Confira o histórico antes de repetir.');
  for(const row of statement.purchases)equal(previous.finance.creditPurchases.find(item=>item.id===row.id),row,'Um item de fatura importado foi alterado ou excluído. Confira o histórico antes de repetir.');
  return {data:structuredClone(previous),changed:false,report:{...existing.report,alreadyImported:true,balanceBefore,balanceAfter:balanceBefore}};
 }
 if(previous.finance?.bankStatementImports!==undefined&&!Array.isArray(previous.finance.bankStatementImports))reject('Histórico de importações inválido.');
 const before=structuredClone(previous),data=structuredClone(previous),finance=F.ensure(data);
 const seedId='opening-invoice:nubank:'+statement.invoiceMonth,seed=finance.creditPurchases.find(row=>row.id===seedId);
 const rule=finance.recurringBills.find(row=>row.cardId==='nubank'||row.id==='card:nubank');
 const bill=finance.bills.find(row=>row.month===statement.invoiceMonth&&row.source==='recurring'&&row.sourceId===rule?.id);
 if(!seed||!rule||!bill||bill.status!=='pending'||bill.dueDate!==statement.invoiceDueDate)reject('A fatura pendente e o saldo anterior de novembro precisam estar cadastrados para conciliar.');
 const other=finance.creditPurchases.filter(row=>row.cardId==='nubank'&&row.id!==seedId&&row.installments.some(part=>part.date.slice(0,7)===statement.invoiceMonth));
 if(other.length||(finance.creditEdits||[]).some(row=>row.purchaseId===seedId)||seed.installments.length!==1)reject('Há compras ou ajustes já detalhados nessa fatura. É necessário conferir duplicidades antes de importar.');
 const declared=bill.expectedAmount,residual=cents(declared)-cents(statement.creditTotal);
 if(residual<0)reject('Os itens do arquivo ultrapassam o valor declarado da fatura. Nenhum valor foi alterado.');
 if(cents(seed.amount)!==cents(declared)||cents(rule.expectedAmount||0)!==0)reject('O saldo anterior não corresponde ao total declarado da fatura.');
 const originalSeed=structuredClone(seed);
 if(residual){seed.amount=residual/100;seed.installments[0].amount=residual/100;seed.description='Saldo não detalhado da fatura · Nubank · '+statement.invoiceMonth;}
 else{
  finance.creditPurchases=finance.creditPurchases.filter(row=>row.id!==seedId);
  const originalReceipt=finance.cardInvoiceImports?.find(row=>row.id===seedId);if(originalReceipt)originalReceipt.purchaseId=null;
 }
 F.syncMonth(data,statement.invoiceMonth);
 for(const purchase of statement.purchases){
  if(data.finance.creditPurchases.some(row=>row.id===purchase.id))reject('Há itens da fatura já presentes sem recibo de conciliação.');
  const added=F.recordCreditPurchase(data,purchase);added.id=purchase.id;
 }
 // recordCreditPurchase replaces finance with a staged clone.
 const afterFinance=data.finance;
 for(const row of statement.debits){
  if(data.transactions.some(existing=>existing.id===row.id))reject('Há compras de débito já importadas sem recibo de conciliação.');
  data.transactions.push(row);
 }
 const importedBalance=F.currentBalance(data,asOf);
 if(cents(importedBalance)!==cents(balanceBefore))F.setCurrentBalance(data,balanceBefore,asOf,'Conciliação de importação histórica Nubank: compras no débito de '+statement.month+' já refletidas no saldo informado; preservar o saldo atual.');
 const afterBill=afterFinance.bills.find(row=>row.id===bill.id),balanceAfter=F.currentBalance(data,asOf);
 if(afterBill.expectedAmount!==declared||afterBill.dueDate!==bill.dueDate||cents(balanceAfter)!==cents(balanceBefore))reject('A conciliação alteraria o saldo ou o total declarado da fatura.');
 equal(data.transactions.slice(0,before.transactions.length),before.transactions,'Um lançamento anterior seria alterado.');
 equal(afterFinance.openingBalance,before.finance.openingBalance,'O saldo inicial seria alterado.');
 equal(afterFinance.adjustments.slice(0,before.finance.adjustments.length),before.finance.adjustments,'O histórico de saldo seria alterado.');
 equal(afterFinance.bills.filter(row=>row.id!==bill.id),before.finance.bills.filter(row=>row.id!==bill.id),'Outra conta ou fatura seria alterada.');
 equal(afterFinance.recurringBills,before.finance.recurringBills,'Uma conta recorrente seria alterada.');
 equal(afterFinance.monthlyPlans,before.finance.monthlyPlans,'O planejamento seria alterado.');
 if(!F.validateFinance(data))reject('A conciliação não passou pela validação financeira.');
 const report={debitCount:statement.debits.length,debitTotal:statement.debitTotal,creditCount:statement.purchases.length,creditTotal:statement.creditTotal,ignoredBankRows:statement.ignoredBankRows,ignoredCreditPayments:statement.ignoredCreditPayments,residual:residual/100,invoiceTotal:declared,invoiceDueDate:bill.dueDate,balanceBefore,balanceAfter,otherInvoicesPreserved:true,existingTransactionsPreserved:true};
 afterFinance.bankStatementImports ||= [];
 afterFinance.bankStatementImports.push({id:importId,sourceHashes:statement.sourceHashes,createdAt:input.createdAt||new Date().toISOString(),username:input.username,originalSeed,transactionIds:statement.debits.map(row=>row.id),purchaseIds:statement.purchases.map(row=>row.id),report});
 return {data,changed:true,report};
}
