// Bridge the shared server/browser engine into module scope without a global API.
import '../shared/finance-core.js';
const FinanceCore=globalThis.FinanceCore;
delete globalThis.FinanceCore;
export default FinanceCore;
