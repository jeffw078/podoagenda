import '../finance-core.js';

const F=globalThis.FinanceCore;
const banks={nubank:'Nubank',mercado_pago:'Mercado Pago'};
const reject=message=>{throw Object.assign(new Error(message),{code:'INVOICE_IMPORT_INVALID'})};
const cents=value=>Math.round(value*100);
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function normalizeInvoicePlan(input){
 if(!input||input.username!=='jefferson'||!validDate(input.capturedDate)||!Array.isArray(input.invoices)||!input.invoices.length)reject('Informe as faturas do Jefferson e a data do levantamento.');
 const keys=new Set(),days=new Map();
 const invoices=input.invoices.map(row=>{
  if(!row||!Object.hasOwn(banks,row.cardId)||!validDate(row.dueDate)||row.month!==row.dueDate.slice(0,7)||row.month<input.capturedDate.slice(0,7)||!Number.isSafeInteger(cents(row.amount))||row.amount!==cents(row.amount)/100||row.amount<=0)reject('Informe cartão, mês, vencimento e valor positivo em centavos para cada fatura.');
  const key=row.cardId+':'+row.month,dueDay=Number(row.dueDate.slice(8));
  if(keys.has(key))reject('O levantamento contém uma fatura repetida.');
  if(days.has(row.cardId)&&days.get(row.cardId)!==dueDay)reject('Use o mesmo dia de vencimento para cada cartão.');
  keys.add(key);days.set(row.cardId,dueDay);
  return {cardId:row.cardId,month:row.month,dueDate:row.dueDate,amount:row.amount};
 }).sort((a,b)=>a.cardId.localeCompare(b.cardId)||a.month.localeCompare(b.month));
 return {username:'jefferson',capturedDate:input.capturedDate,invoices};
}

// One-off, idempotent import. Private invoice amounts live in an ignored local file.
export function prepareInvoiceImport(previous,input){
 const plan=normalizeInvoicePlan(input);
 if(!F.validateFinance(previous))reject('Os dados financeiros existentes precisam ser corrigidos antes do lançamento.');
 if((previous.transactions||[]).some(row=>row.paymentMethod==='credit'&&row.date>=plan.capturedDate.slice(0,7)+'-01'))reject('Há parcelas antigas sem identificação do banco. É necessário conciliá-las antes de adicionar as faturas para evitar duplicação.');
 const data=structuredClone(previous),earliest=plan.invoices.reduce((value,row)=>row.month<value?row.month:value,plan.invoices[0].month);
 F.ensureCreditCards(data,earliest);
 let created=0,alreadyImported=0;
 if(data.finance.cardInvoiceImports!==undefined&&!Array.isArray(data.finance.cardInvoiceImports))reject('Histórico do lançamento de faturas inválido.');
 data.finance.cardInvoiceImports ||= [];
 for(const cardId of new Set(plan.invoices.map(row=>row.cardId))){
  const rule=data.finance.recurringBills.find(row=>row.cardId===cardId||row.id==='card:'+cardId),rows=plan.invoices.filter(row=>row.cardId===cardId);
  if(rows.every(invoice=>data.finance.cardInvoiceImports.some(row=>row.id==='opening-invoice:'+invoice.cardId+':'+invoice.month)))continue;
  const dueDay=Number(rows[0].dueDate.slice(8));
  F.saveRecurring(data,{...rule,expectedAmount:0,fixed:false,active:true,dueDay,startMonth:rule.startMonth<earliest?rule.startMonth:earliest,endMonth:null});
 }
 for(const invoice of plan.invoices){
  const importId='opening-invoice:'+invoice.cardId+':'+invoice.month;
  const existing=data.finance.cardInvoiceImports.find(row=>row.id===importId);
  if(existing){
   if(existing.amount!==invoice.amount||existing.dueDate!==invoice.dueDate)reject('A fatura '+invoice.month+' de '+banks[invoice.cardId]+' já foi importada com outro valor ou vencimento.');
   alreadyImported++;continue;
  }
  const rule=data.finance.recurringBills.find(row=>row.cardId===invoice.cardId||row.id==='card:'+invoice.cardId);
  const billId='recurring:'+rule.id+':'+invoice.month,bill=data.finance.bills.find(row=>row.id===billId);
  if(bill&&bill.status!=='pending')reject('A fatura '+invoice.month+' de '+banks[invoice.cardId]+' já está paga ou cancelada.');
  const known=data.finance.creditPurchases.filter(row=>row.cardId===invoice.cardId).flatMap(row=>row.installments.filter(part=>part.date.slice(0,7)===invoice.month)).reduce((sum,part)=>sum+cents(part.amount),0);
  const remainder=cents(invoice.amount)-known;
  if(remainder<0)reject('As compras cadastradas em '+invoice.month+' de '+banks[invoice.cardId]+' superam o total informado. Confira o levantamento.');
  let purchaseId=null;
  if(remainder>0){
   const purchase=F.recordCreditPurchase(data,{cardId:invoice.cardId,description:'Saldo anterior da fatura · '+banks[invoice.cardId]+' · '+invoice.month,category:'Cartão de crédito',purchaseDate:plan.capturedDate,amount:remainder/100,items:[],installments:[{date:invoice.month+'-01',amount:remainder/100,installmentNumber:1,installmentCount:1}]});
   purchase.id=importId;purchaseId=importId;
  }
  data.finance.cardInvoiceImports.push({id:importId,...invoice,purchaseId});
  F.syncMonth(data,invoice.month);
  const saved=data.finance.bills.find(row=>row.id===billId);
  if(saved.expectedAmount!==invoice.amount||saved.dueDate!==invoice.dueDate)reject('O total calculado da fatura não corresponde ao levantamento.');
  created++;
 }
 if(!F.validateFinanceChange(previous,data))reject('O lançamento não passou pela validação financeira. Nenhuma gravação foi feita.');
 return {data,created,alreadyImported,changed:JSON.stringify(previous)!==JSON.stringify(data)};
}
