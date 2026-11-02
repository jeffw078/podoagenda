import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {statementCategory} from './bank-statement-import.js';
import {prepareExpenseRemoval} from './expense-removals.js';
import '../src/shared/finance-core.js';

const F=globalThis.FinanceCore;
const fail=message=>{throw Object.assign(Error(message),{code:'OFX_IMPORT_INVALID'});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const leaf=(source,name)=>source.match(new RegExp('<'+name+'>([^<\\r\\n]+)','i'))?.[1].trim();
function date(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Data OFX inválida.');
 return value;
}
function amount(value){
 if(!/^-?\d+\.\d{2}$/.test(value||''))fail('Valor OFX inválido.');
 const negative=value.startsWith('-'),[whole,fraction]=value.replace('-','').split('.');
 const result=Number(BigInt(whole)*100n+BigInt(fraction))*(negative?-1:1);
 if(!Number.isSafeInteger(result)||Math.abs(result)>10_000_000_000)fail('Valor OFX fora do limite.');
 return result;
}
const ofxDate=value=>{if(!/^\d{8}/.test(value||''))fail('Data OFX ausente.');return date(value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8));};
const decode=value=>value.replace(/&(?:amp|lt|gt|quot|apos);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[entity]));

export function parseNubankOfx(source){
 if(typeof source!=='string'||source.length>2_000_000||!/<CREDITCARDMSGSRSV1>/i.test(source)||leaf(source,'CURDEF')!=='BRL')fail('O arquivo precisa ser um extrato OFX de cartão em reais.');
 const accountId=leaf(source,'ACCTID');if(!accountId)fail('Cartão não identificado no OFX.');
 const start=ofxDate(leaf(source,'DTSTART')),end=ofxDate(leaf(source,'DTEND'));
 if(start>end)fail('Período OFX inválido.');
 const seen=new Set(),charges=[];let ignoredPayments=0;
 const blocks=[...source.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
 for(const [,block] of blocks){
  const posted=ofxDate(leaf(block,'DTPOSTED')),value=amount(leaf(block,'TRNAMT')),type=leaf(block,'TRNTYPE');
  const fitid=leaf(block,'FITID'),description=decode(leaf(block,'MEMO')||leaf(block,'NAME')||'');
  if(!fitid||!description||description.length>500||posted<start||posted>end)fail('Lançamento OFX incompleto ou fora do período.');
  // Nubank shares FITID between an international purchase and its IOF.
  const signature=JSON.stringify([accountId,fitid,posted,value,description]);
  if(seen.has(signature))fail('Lançamento OFX duplicado.');seen.add(signature);
  if(value>0&&type==='CREDIT'&&/^pagamento recebido$/i.test(description)){ignoredPayments++;continue;}
  if(value>=0||type!=='DEBIT')fail('Crédito ou estorno não reconhecido; é necessário conciliar esse lançamento.');
  charges.push({id:'ofx:nubank:'+hash(signature).slice(0,40),description,purchaseDate:posted,amount:-value/100});
 }
 if(!charges.length)fail('O arquivo não contém cobranças.');
 const chargeCents=charges.reduce((sum,row)=>sum+Math.round(row.amount*100),0),ledger=amount(leaf(source,'BALAMT'));
 if(ledger>=0||-ledger<chargeCents||-ledger-chargeCents>5)fail('O total da fatura exige conciliação antes da importação.');
 return {charges,chargeTotal:chargeCents/100,invoiceTotal:-ledger/100,ignoredPayments,start,end,sourceHash:hash(source)};
}

function inferCategory(description,previous){
 const key=normalize(description);
 const known=[...(previous.finance?.creditPurchases||[]),...(previous.transactions||[])].find(row=>normalize(row.description||'')===key&&row.category&&row.category!=='Outros'&&row.category!=='Cartão de crédito');
 if(known)return known.category;
 if(/agua viva/.test(key))return 'Água';
 if(/bebidas|panific|pizzaria/.test(key))return 'Alimentação';
 if(/engenharia/.test(key))return 'Manutenção';
 return statementCategory(description);
}

export function prepareNubankOfxReplacement(previous,input){
 if(input.username!=='jefferson')fail('Esta substituição se destina à conta pessoal do Jefferson.');
 const asOf=date(input.asOf),invoiceDueDate=date(input.invoiceDueDate),invoiceMonth=invoiceDueDate.slice(0,7),expenseMonth=input.expenseMonth;
 const createdAt=input.createdAt||new Date().toISOString();
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(expenseMonth||''))fail('Mês de substituição inválido.');
 const parsed=parseNubankOfx(input.ofx);
 if(parsed.end.slice(0,7)!==expenseMonth||parsed.end>asOf||invoiceMonth<=expenseMonth)fail('O período OFX não corresponde ao mês de substituição e à fatura.');
 if(!F.validateFinance(previous))fail('Os dados financeiros existentes são inválidos.');
 const receipts=previous.finance?.ofxImports||[];
 if(!Array.isArray(receipts))fail('Histórico OFX inválido.');
 const oldReceipt=receipts.find(receipt=>receipt.invoiceMonth===invoiceMonth&&receipt.cardId==='nubank');
 if(oldReceipt){
  if(oldReceipt.sourceHash!==parsed.sourceHash)fail('Esta fatura já foi substituída por outro OFX. Confira antes de repetir.');
  for(const expected of oldReceipt.purchases)if(!isDeepStrictEqual(previous.finance.creditPurchases.find(p=>p.id===expected.id),expected))fail('Uma cobrança importada foi alterada ou excluída.');
  return {data:structuredClone(previous),changed:false,report:{...oldReceipt.report,alreadyImported:true}};
 }
 const rule=previous.finance?.recurringBills.find(row=>row.cardId==='nubank'||row.id==='card:nubank');
 const bill=previous.finance?.bills.find(row=>row.source==='recurring'&&row.sourceId===rule?.id&&row.month===invoiceMonth);
 if(!rule||!bill||bill.status!=='pending'||bill.dueDate!==invoiceDueDate||rule.expectedAmount!==0)fail('A fatura Nubank precisa estar pendente, com vencimento correspondente e sem base manual.');
 const oldPurchases=previous.finance.creditPurchases.filter(p=>p.cardId==='nubank'&&p.installments.some(part=>part.date.slice(0,7)===invoiceMonth));
 if(oldPurchases.some(p=>p.installments.some(part=>part.date.slice(0,7)!==invoiceMonth)))fail('Uma compra desta fatura também tem parcelas futuras. Confira antes de substituir.');
 const oldTransactions=(previous.transactions||[]).filter(row=>row.type==='expense'&&row.date?.slice(0,7)===expenseMonth);
 if(oldTransactions.some(row=>row.billId||row.financeKind))fail('Há pagamentos de contas ou reservas em outubro; confira antes de substituí-los.');
 const balanceBefore=F.currentBalance(structuredClone(previous),asOf);
 const reason='Substituição dos gastos de '+expenseMonth+' pelo OFX Nubank da fatura '+invoiceMonth+', solicitada por Jefferson.';
 let data=structuredClone(previous);
 for(const [kind,rows] of [['transaction',oldTransactions],['credit',oldPurchases]])for(const row of rows)data=prepareExpenseRemoval(data,{kind,id:row.id,reason},'jefferson',createdAt,F).data;
 const purchases=parsed.charges.map(row=>({...row,cardId:'nubank',category:inferCategory(row.description,previous),items:[],installments:[{date:invoiceMonth+'-01',amount:row.amount,installmentNumber:1,installmentCount:1}]}));
 const residual=(Math.round(parsed.invoiceTotal*100)-Math.round(parsed.chargeTotal*100))/100;
 if(residual)purchases.push({id:'ofx:reconciliation:'+parsed.sourceHash.slice(0,40),cardId:'nubank',description:'Diferença de conciliação da fatura · Nubank',category:'Cartão de crédito',purchaseDate:parsed.end,amount:residual,items:[],installments:[{date:invoiceMonth+'-01',amount:residual,installmentNumber:1,installmentCount:1}]});
 for(const purchase of purchases){
  if(data.finance.creditPurchases.some(row=>row.id===purchase.id))fail('Cobrança OFX já cadastrada sem recibo.');
  F.recordCreditPurchase(data,purchase).id=purchase.id;
 }
 if(F.currentBalance(data,asOf)!==balanceBefore)F.setCurrentBalance(data,balanceBefore,asOf,'Conciliação histórica OFX Nubank: substituir gastos de '+expenseMonth+' por despesas de cartão sem alterar o saldo atual já informado.');
 const unchanged=(actual,expected,message)=>{if(!isDeepStrictEqual(actual,expected))fail(message);};
 unchanged(data.transactions,previous.transactions.filter(row=>!oldTransactions.some(old=>old.id===row.id)),'Outro lançamento seria alterado.');
 unchanged(data.finance.creditPurchases.filter(row=>!purchases.some(p=>p.id===row.id)),previous.finance.creditPurchases.filter(row=>!oldPurchases.some(p=>p.id===row.id)),'Uma parcela futura ou outro cartão seria alterado.');
 unchanged(data.finance.bills.filter(row=>row.id!==bill.id),previous.finance.bills.filter(row=>row.id!==bill.id),'Outra conta seria alterada.');
 unchanged(data.finance.recurringBills,previous.finance.recurringBills,'Uma recorrência seria alterada.');
 unchanged(data.finance.monthlyPlans,previous.finance.monthlyPlans,'O planejamento seria alterado.');
 if(data.finance.bills.find(row=>row.id===bill.id).expectedAmount!==parsed.invoiceTotal||F.currentBalance(data,asOf)!==balanceBefore||!F.validateFinance(data))fail('A conciliação não passou pela validação financeira.');
 const categoryCents=new Map();for(const purchase of purchases)categoryCents.set(purchase.category,(categoryCents.get(purchase.category)||0)+Math.round(purchase.amount*100));
 const report={expenseMonth,invoiceMonth,invoiceDueDate,removedTransactions:oldTransactions.length,removedCreditPurchases:oldPurchases.length,chargeCount:parsed.charges.length,chargeTotal:parsed.chargeTotal,invoiceTotal:parsed.invoiceTotal,residual,ignoredPayments:parsed.ignoredPayments,balanceBefore,balanceAfter:F.currentBalance(data,asOf),categories:[...categoryCents].map(([category,total])=>({category,amount:total/100}))};
 data.finance.ofxImports=[...receipts,{id:'nubank-ofx:'+invoiceMonth+':'+parsed.sourceHash,cardId:'nubank',sourceHash:parsed.sourceHash,invoiceMonth,expenseMonth,createdAt,actor:'jefferson',purchases:structuredClone(purchases),removedTransactionIds:oldTransactions.map(row=>row.id),removedPurchaseIds:oldPurchases.map(row=>row.id),report}];
 return {data,changed:true,report};
}
