// A plain-English BUSINESS glossary — Clay's OWN curated definitions, so he answers
// "what does X mean?" from a vetted, consistent source instead of improvising a meaning for
// a term a builder will make real decisions on. Ported in mechanism from Arbo's glossary,
// with Clay's own business-terminology content (never crypto).
//
// The convictions:
//   • PLAIN WORDS. A blind builder hears these through VoiceOver, often while learning — so a
//     definition never explains jargon with more jargon. Where a term is a formula, it's said
//     in words ("divide what you spent by how many you gained"), not symbols.
//   • WHAT IT IS, not what to do. A definition explains the concept; it never tells the builder
//     to raise prices, take funding, or expect a result. No advice, no hype.
//   • CONSISTENT. The same term returns the same definition every time, so Clay can't drift.
//
// When a term is NOT carried here, defineTerm returns null and the caller lets Clay explain it
// in plain words as general knowledge — never presented as an authoritative Clay definition.

const GLOSSARY = {
  // ── Financial statements & core accounting ────────────────────────────────
  'profit and loss': {
    term: 'Profit and Loss (P&L)',
    definition:
      "Also called an income statement. A summary of what your business earned and what it spent over a stretch of time — a month, a quarter, a year — ending in whether you made a profit or a loss. It starts with revenue at the top, subtracts your costs step by step, and arrives at your net profit at the bottom.",
  },
  'balance sheet': {
    term: 'Balance Sheet',
    definition:
      "A snapshot of what your business owns and owes on a single day. It lists your assets (what you own — cash, equipment, money owed to you) on one side, and your liabilities (what you owe — loans, unpaid bills) plus equity (the owners' share) on the other. The two sides always balance.",
  },
  'cash flow statement': {
    term: 'Cash Flow Statement',
    definition:
      "A record of the actual cash that moved in and out of your business over a period — not profit on paper, but real money entering and leaving. It matters because a business can look profitable and still run out of cash if money comes in slower than it goes out.",
  },
  'revenue': {
    term: 'Revenue (Top Line)',
    definition:
      "The total money your business takes in from sales before any costs are subtracted. It's called the 'top line' because it sits at the top of the profit-and-loss statement. Revenue is not profit — it's what comes in before you pay for anything.",
  },
  'cost of goods sold': {
    term: 'Cost of Goods Sold (COGS)',
    definition:
      "The direct cost of making or buying the thing you sell — materials, the wholesale cost of a product, the direct labor to produce it. It does not include rent, marketing, or salaries for people not making the product. Revenue minus COGS gives your gross profit.",
  },
  'operating expenses': {
    term: 'Operating Expenses (OpEx)',
    definition:
      "The ongoing costs of running the business that aren't the direct cost of the product — rent, salaries, software, marketing, utilities. Sometimes called overhead. These are subtracted after gross profit to get your operating profit.",
  },
  'accounts receivable': {
    term: 'Accounts Receivable (AR)',
    definition:
      "Money customers owe you that you haven't collected yet — invoices you've sent but that haven't been paid. It counts as an asset because it's coming to you, but until it lands it isn't cash you can spend.",
  },
  'accounts payable': {
    term: 'Accounts Payable (AP)',
    definition:
      "Money you owe others that you haven't paid yet — bills and invoices from suppliers sitting on your desk. It's the mirror image of accounts receivable: what you owe rather than what you're owed.",
  },
  'depreciation': {
    term: 'Depreciation',
    definition:
      "Spreading the cost of a physical thing that lasts years — a vehicle, an oven, a machine — across its useful life instead of counting the whole cost in the month you bought it. It's an accounting charge, not cash leaving your account each time.",
  },
  'amortization': {
    term: 'Amortization',
    definition:
      "The same idea as depreciation, but for things you can't touch — software, a patent, goodwill. You spread their cost over the years they're useful rather than all at once. (The word also describes paying off a loan in steady installments.)",
  },
  'capital expenditure': {
    term: 'Capital Expenditure (CapEx)',
    definition:
      "Money spent on big, long-lasting things the business will use for years — equipment, vehicles, building out a space. It's treated differently from everyday running costs because the value lasts well beyond the month you bought it.",
  },
  'accrual accounting': {
    term: 'Accrual vs Cash Accounting',
    definition:
      "Two ways to record money. Cash accounting counts income when the cash actually arrives and expenses when you actually pay. Accrual accounting counts income when you earn it and expenses when you incur them, even if the money moves later. Accrual gives a truer picture of a period; cash is simpler.",
  },

  // ── Profitability & margins ───────────────────────────────────────────────
  'gross profit': {
    term: 'Gross Profit',
    definition:
      "What's left of your revenue after subtracting only the direct cost of what you sold (COGS). It's the money the product itself generates, before rent, marketing, or salaries. As a percentage of revenue it's called gross margin.",
  },
  'gross margin': {
    term: 'Gross Margin',
    definition:
      "Gross profit shown as a percentage of revenue — how many cents of each dollar of sales are left after the direct cost of the product. If you sell something for $100 and it cost you $40 to make, your gross margin is 60%.",
  },
  'net profit': {
    term: 'Net Profit (Bottom Line)',
    definition:
      "What's truly left after every cost is subtracted from revenue — direct costs, operating expenses, interest, and taxes. It's the 'bottom line' because it's the final number on the profit-and-loss statement. As a percentage of revenue it's your net margin.",
  },
  'operating income': {
    term: 'Operating Income (Operating Profit)',
    definition:
      "The profit from your core business operations — revenue minus the direct cost of the product and minus operating expenses — but before interest and taxes. It shows how well the actual business runs, separate from how it's financed or taxed.",
  },
  'ebitda': {
    term: 'EBITDA',
    definition:
      "Earnings Before Interest, Taxes, Depreciation, and Amortization. A measure of the profit from a company's core operations before four things are subtracted: the cost of borrowing (interest), taxes, and two non-cash accounting charges (depreciation and amortization). People use it to compare the underlying profitability of different businesses without those factors clouding the view.",
  },
  'ebit': {
    term: 'EBIT',
    definition:
      "Earnings Before Interest and Taxes — your operating profit before the cost of borrowing and taxes are taken out. It's EBITDA with depreciation and amortization left in, so it sits a step closer to true net profit.",
  },
  'profit margin': {
    term: 'Profit Margin',
    definition:
      "The share of your revenue that ends up as profit, shown as a percentage. If you keep $20 of profit from every $100 in sales, your margin is 20%. 'Gross margin' looks at it after direct costs only; 'net margin' after every cost.",
  },
  'markup': {
    term: 'Markup vs Margin',
    definition:
      "Two ways of describing the gap between cost and price. Markup is that gap as a percentage of your cost — buy for $50, sell for $75, that's a 50% markup. Margin is the same gap as a percentage of the selling price — here, $25 on $75, about 33%. They describe the same dollars from different angles.",
  },
  'contribution margin': {
    term: 'Contribution Margin',
    definition:
      "What one sale contributes toward covering your fixed costs, after its own variable costs are paid — the selling price minus the direct cost of that one unit. Once enough units' contributions add up to cover all your fixed costs, you've hit break-even and further sales turn to profit.",
  },
  'break even': {
    term: 'Break-Even Point',
    definition:
      "The point where your total sales exactly cover your total costs — you're neither losing nor making money. Below it you're operating at a loss; above it, every additional sale starts producing profit. It tells you how much you must sell just to not lose money.",
  },
  'fixed costs': {
    term: 'Fixed vs Variable Costs',
    definition:
      "Fixed costs stay roughly the same no matter how much you sell — rent, insurance, a salary. Variable costs rise and fall with sales — materials, packaging, payment fees. Knowing which is which tells you how much each extra sale really costs you.",
  },

  // ── Cash & solvency ───────────────────────────────────────────────────────
  'cash flow': {
    term: 'Cash Flow',
    definition:
      "The movement of actual money in and out of your business over time. Positive cash flow means more is coming in than going out; negative means the reverse. It's separate from profit — a profitable business can still hit trouble if cash arrives too slowly to cover the bills.",
  },
  'burn rate': {
    term: 'Burn Rate',
    definition:
      "How fast a business is spending down its cash, usually stated per month. If you're spending $10,000 more than you bring in each month, your burn rate is $10,000 a month. It matters most for a young business living on savings or investment.",
  },
  'runway': {
    term: 'Runway',
    definition:
      "How long your business can keep operating before it runs out of cash, at your current burn rate. If you have $60,000 in the bank and burn $10,000 a month, you have six months of runway. It answers: how much time do I have?",
  },
  'working capital': {
    term: 'Working Capital',
    definition:
      "The short-term money available to run day-to-day operations — what you own that can quickly become cash (like unpaid customer invoices and inventory) minus what you owe soon (like supplier bills). Positive working capital means you can cover near-term obligations.",
  },
  'liquidity': {
    term: 'Liquidity',
    definition:
      "How easily you can turn what you own into cash to pay what you owe. Cash is perfectly liquid; a building is not. A business can be worth a lot on paper yet be short on liquidity if little of it can be spent right now.",
  },
  'overhead': {
    term: 'Overhead',
    definition:
      "The ongoing costs of keeping the business running that aren't tied to making any single product — rent, utilities, insurance, admin salaries. It's the baseline you have to cover every month before you've earned a cent of profit.",
  },

  // ── Unit economics & growth metrics ───────────────────────────────────────
  'unit economics': {
    term: 'Unit Economics',
    definition:
      "The profit or loss of a single sale or a single customer, looked at on its own — what one unit brings in versus what it costs to deliver. If the economics of one unit don't work, selling more only loses money faster, so this is often where a business is judged.",
  },
  'customer acquisition cost': {
    term: 'Customer Acquisition Cost (CAC)',
    definition:
      "The average amount you spend to win one new customer. You work it out by adding up everything you spent on sales and marketing over a period, then dividing by the number of new customers you gained in that period. Spend $1,000, gain 10 customers, and your CAC is $100. It tells you what growth actually costs.",
  },
  'lifetime value': {
    term: 'Lifetime Value (LTV or CLV)',
    definition:
      "The total profit you expect from one customer over the whole time they stay with you — every purchase they'll make, minus what it costs to serve them. Compared against what it cost to acquire them (CAC), it shows whether a customer is worth more than you paid to win them.",
  },
  'ltv cac ratio': {
    term: 'LTV:CAC Ratio',
    definition:
      "Lifetime value divided by customer acquisition cost — how much a customer is worth compared to what you paid to get them. A ratio of 3 means each customer returns three times their acquisition cost over time. It's a quick read on whether growth is sustainable.",
  },
  'payback period': {
    term: 'Payback Period',
    definition:
      "How long it takes to earn back the money you spent acquiring a customer. If you spend $100 to win someone and they bring in $25 of profit a month, your payback period is four months. Shorter means your cash comes back sooner to fund the next customer.",
  },
  'churn rate': {
    term: 'Churn Rate',
    definition:
      "The share of customers (or revenue) you lose over a period — the people who cancel or stop buying. If 100 customers start the month and 5 leave, that's 5% monthly churn. High churn means you're filling a leaky bucket, winning customers only to lose them.",
  },
  'retention rate': {
    term: 'Retention Rate',
    definition:
      "The share of customers who stay with you over a period — the flip side of churn. If you keep 95 of every 100 customers through the month, your retention is 95%. Keeping customers is usually far cheaper than winning new ones, so this number carries weight.",
  },
  'monthly recurring revenue': {
    term: 'Monthly Recurring Revenue (MRR)',
    definition:
      "The predictable revenue you can count on each month from subscriptions or ongoing plans. If 100 customers each pay $30 a month, your MRR is $3,000. It's prized because it's steady and lets you see growth month over month clearly.",
  },
  'annual recurring revenue': {
    term: 'Annual Recurring Revenue (ARR)',
    definition:
      "The yearly version of monthly recurring revenue — the predictable subscription revenue you expect over a full year. It's usually your monthly recurring revenue times twelve, and it's how subscription businesses often state their size.",
  },
  'average order value': {
    term: 'Average Order Value (AOV)',
    definition:
      "The average amount a customer spends in a single order — total revenue divided by the number of orders. If you make $2,000 across 40 orders, your AOV is $50. Raising it, through bundles or add-ons, grows revenue without needing more customers.",
  },
  'average revenue per user': {
    term: 'Average Revenue Per User (ARPU)',
    definition:
      "The average revenue each customer brings in over a period — total revenue divided by the number of customers. It helps you see whether growth is coming from more customers, or from each customer spending more.",
  },
  'return on investment': {
    term: 'Return on Investment (ROI)',
    definition:
      "How much you gained compared to what you put in, as a percentage. Put in $1,000, get back $1,500, and you made $500 on $1,000 — a 50% return. It's a general way to judge whether spending was worth it.",
  },
  'return on ad spend': {
    term: 'Return on Ad Spend (ROAS)',
    definition:
      "The revenue you earn for every dollar spent on advertising. Spend $1,000 on ads and make $4,000 in sales from them, and your ROAS is 4 — four dollars back for each dollar spent. It measures whether advertising is paying off.",
  },

  // ── Marketing & sales ─────────────────────────────────────────────────────
  'conversion rate': {
    term: 'Conversion Rate',
    definition:
      "The share of people who take the action you wanted — buying, signing up, booking — out of everyone who had the chance. If 100 people visit and 3 buy, that's a 3% conversion rate. Small improvements here can lift revenue without any extra traffic.",
  },
  'click through rate': {
    term: 'Click-Through Rate (CTR)',
    definition:
      "The share of people who click something — an ad, a link, an email button — out of everyone who saw it. If 1,000 people see an ad and 20 click, that's a 2% click-through rate. It measures how compelling the thing they saw was.",
  },
  'sales funnel': {
    term: 'Sales Funnel (Pipeline)',
    definition:
      "The path a stranger travels to become a customer, seen as a funnel because many enter at the top and fewer reach the bottom: aware of you, then interested, then considering, then buying. Mapping it shows where people drop off so you can fix the leak.",
  },
  'lead': {
    term: 'Lead',
    definition:
      "A potential customer who has shown some interest — signed up for a list, filled a form, asked a question. A lead isn't a customer yet; it's a name worth following up. 'Qualified' leads are the ones who look like a genuine fit.",
  },
  'cpm cpc cpa': {
    term: 'CPM, CPC, CPA',
    definition:
      "Three ways advertising is priced. CPM is cost per thousand times your ad is shown. CPC is cost per click — you pay only when someone clicks. CPA is cost per action — you pay only when someone does the thing you wanted, like a purchase. Each shifts more of the risk onto a different party.",
  },
  'net promoter score': {
    term: 'Net Promoter Score (NPS)',
    definition:
      "A simple gauge of how loyal your customers are, from asking one question: how likely are you to recommend us? Answers are sorted into fans, neutrals, and critics, and the critics are subtracted from the fans to give a single score. It's a quick pulse on goodwill.",
  },
  'crm': {
    term: 'CRM (Customer Relationship Management)',
    definition:
      "A system — usually software — for keeping track of your customers and leads: who they are, what they've bought, when you last spoke, what to do next. It keeps relationships from slipping through the cracks as you grow.",
  },
  'upsell': {
    term: 'Upsell vs Cross-Sell',
    definition:
      "Two ways to grow a sale. Upselling offers a better or bigger version of what someone's already buying. Cross-selling offers a related extra alongside it. Both raise the value of a customer you've already won.",
  },

  // ── Market sizing & strategy ──────────────────────────────────────────────
  'total addressable market': {
    term: 'Total Addressable Market (TAM)',
    definition:
      "The full size of the demand for what you offer if you could reach absolutely everyone who might want it — the whole pie. It's the biggest, most theoretical version of your market, used to show how much room there is in principle.",
  },
  'serviceable addressable market': {
    term: 'Serviceable Addressable Market (SAM)',
    definition:
      "The slice of the total market you could actually serve, given what you offer and where you can reach — narrowed by your product, your region, your channel. It's more realistic than the total market because it drops the parts you can't reach.",
  },
  'serviceable obtainable market': {
    term: 'Serviceable Obtainable Market (SOM)',
    definition:
      "The share of the serviceable market you can realistically win in the near term, given your competition and your resources — the piece you can actually capture. It's the most grounded of the three market sizes.",
  },
  'value proposition': {
    term: 'Value Proposition',
    definition:
      "The clear reason a customer should choose you — the specific benefit you give and the problem you solve, stated plainly. A strong one answers, in a sentence, 'why you and not someone else?'",
  },
  'competitive advantage': {
    term: 'Competitive Advantage (Moat)',
    definition:
      "The thing that makes it hard for competitors to copy or beat you — a unique skill, a loyal audience, a cost others can't match, a brand people trust. Sometimes called a moat, after the water that protects a castle. It's what keeps an advantage from eroding.",
  },
  'unique selling proposition': {
    term: 'Unique Selling Proposition (USP)',
    definition:
      "The single, specific thing that sets you apart from every alternative — the one claim only you can truly make. It's sharper than a general value proposition: not just why you're good, but why you're different.",
  },
  'business model': {
    term: 'Business Model',
    definition:
      "The overall logic of how your business creates value and makes money — who you serve, what you offer them, how you deliver it, and how the cash comes in. It's the whole picture of how the pieces fit together to turn effort into profit.",
  },
  'revenue model': {
    term: 'Revenue Model',
    definition:
      "The specific way your business earns money — a one-time sale, a subscription, a commission on each transaction, advertising, a fee for usage. A single business can combine several. It's one part of the wider business model.",
  },

  // ── Product & go-to-market ────────────────────────────────────────────────
  'product market fit': {
    term: 'Product-Market Fit',
    definition:
      "The moment your product genuinely satisfies a real, strong demand — customers want it, come back, and tell others, and you can feel the pull rather than having to push. Reaching it is often the dividing line between a struggling idea and one that's ready to grow.",
  },
  'minimum viable product': {
    term: 'Minimum Viable Product (MVP)',
    definition:
      "The simplest version of your product that still delivers the core value — just enough to put in front of real customers and learn whether they want it, without building everything first. It trades polish for speed and learning.",
  },
  'go to market': {
    term: 'Go-to-Market (GTM)',
    definition:
      "Your plan for actually reaching customers and making sales — who you're targeting, how you'll reach them, what you'll say, and through which channels. It's the bridge between having a product and having customers.",
  },
  'b2b b2c': {
    term: 'B2B, B2C, D2C',
    definition:
      "Shorthand for who you sell to. B2B is business-to-business — you sell to other companies. B2C is business-to-consumer — you sell to individual people. D2C is direct-to-consumer — a brand selling straight to shoppers without a middle retailer.",
  },
  'saas': {
    term: 'SaaS (Software as a Service)',
    definition:
      "Software you access over the internet for an ongoing fee rather than buying once and installing — think a monthly subscription to a tool. The recurring payment and low cost to serve one more customer are why the model is so common.",
  },

  // ── Operations & commerce ─────────────────────────────────────────────────
  'sku': {
    term: 'SKU (Stock Keeping Unit)',
    definition:
      "A unique code you give each distinct product you sell — a specific size, color, or variant — so you can track its stock and sales exactly. A blue medium shirt and a red medium shirt are two different SKUs.",
  },
  'minimum order quantity': {
    term: 'Minimum Order Quantity (MOQ)',
    definition:
      "The smallest amount a supplier will let you order at once. If a manufacturer's MOQ is 500 units, you can't buy 100 — it shapes how much cash you tie up in inventory up front.",
  },
  'inventory turnover': {
    term: 'Inventory Turnover',
    definition:
      "How many times you sell through and replace your stock over a period. High turnover means goods move quickly and less cash sits on shelves; low turnover means inventory is piling up. It shows how efficiently stock becomes sales.",
  },
  'gross merchandise value': {
    term: 'Gross Merchandise Value (GMV)',
    definition:
      "The total value of everything sold through your platform over a period, before your cut or any costs — common for marketplaces. It measures the size of activity flowing through you, not the money you keep, which is usually a fee on top.",
  },
  'supply chain': {
    term: 'Supply Chain',
    definition:
      "The whole chain of steps and partners that get a product from raw materials to your customer's hands — suppliers, manufacturers, shippers, warehouses. A snag anywhere in it can delay or raise the cost of what you sell.",
  },
  'dropshipping': {
    term: 'Dropshipping',
    definition:
      "Selling products you don't stock yourself: when a customer orders, a supplier ships it directly to them. You never hold inventory, which lowers up-front cost and risk, but you also give up margin and control over shipping and quality.",
  },

  // ── Funding, equity & ownership ───────────────────────────────────────────
  'equity': {
    term: 'Equity',
    definition:
      "Ownership in a business, usually measured in shares. If you own 100% of the equity, the whole business is yours; give some away to an investor or partner and you own less of a (hopefully larger) thing. It's a claim on what the business is worth.",
  },
  'valuation': {
    term: 'Valuation (Pre- and Post-Money)',
    definition:
      "What a business is judged to be worth. In fundraising, 'pre-money' is the value before new investment goes in, and 'post-money' is that value plus the new money. If a business is valued at $1M pre-money and raises $250K, it's worth $1.25M post-money.",
  },
  'dilution': {
    term: 'Dilution',
    definition:
      "The shrinking of your ownership percentage when new shares are created — for an investor or an employee pool. Your slice gets smaller, though the pie may be bigger. Owning 50% of a business worth far more can beat owning 100% of a small one.",
  },
  'cap table': {
    term: 'Cap Table (Capitalization Table)',
    definition:
      "A record of who owns what share of a business — founders, investors, employees — and how much. As you raise money or grant equity, the cap table shows exactly how ownership is split and how it shifts.",
  },
  'venture capital': {
    term: 'Venture Capital (VC)',
    definition:
      "Money invested in young, high-growth businesses in exchange for equity, usually by professional firms managing others' money. They accept high risk hoping a few big winners pay for the many that don't. It suits businesses aiming to grow fast, not every business.",
  },
  'angel investor': {
    term: 'Angel Investor',
    definition:
      "An individual who invests their own money into an early business, often one of the first checks a founder gets, in exchange for equity. Angels usually invest smaller amounts than venture firms and often bring advice and contacts alongside the cash.",
  },
  'bootstrapping': {
    term: 'Bootstrapping',
    definition:
      "Building a business with your own money and the revenue it earns, rather than taking outside investment. It's slower and tighter on cash, but you keep full ownership and control and answer to no one but your customers.",
  },
  'term sheet': {
    term: 'Term Sheet',
    definition:
      "A short document laying out the main terms of an investment deal — how much money, at what valuation, and the key conditions — before the long legal contracts are drawn up. It's the handshake in writing, signalling both sides agree in principle.",
  },
  'due diligence': {
    term: 'Due Diligence',
    definition:
      "The careful checking a buyer or investor does before committing — going through your finances, contracts, and claims to confirm everything is as stated. Passing it is about having your records honest and in order.",
  },
  'exit': {
    term: 'Exit',
    definition:
      "The event where owners cash out their stake in a business — most often by selling the company (an acquisition) or taking it public on a stock market. It's the payoff investors and founders are often building toward.",
  },

  // ── Business structures & basics ──────────────────────────────────────────
  'llc': {
    term: 'LLC (Limited Liability Company)',
    definition:
      "A common way to set up a business in the U.S. that keeps your personal finances separate from the company's, so a business debt or lawsuit generally can't reach your personal savings. It's simpler to run than a corporation while still offering that protection.",
  },
  'sole proprietorship': {
    term: 'Sole Proprietorship',
    definition:
      "The simplest business form: you and the business are legally the same. Easy to start and run, but there's no separation — the business's debts are your debts. It's why many owners eventually move to an LLC for protection.",
  },
  'escrow': {
    term: 'Escrow',
    definition:
      "A neutral third party that holds money or an asset during a deal and only releases it when both sides have met their end. It protects a buyer and seller who don't fully trust each other yet — the cash is safe in the middle until the terms are satisfied.",
  },
  'invoice': {
    term: 'Invoice',
    definition:
      "A bill you send a customer listing what you provided, how much they owe, and by when to pay. It's the formal request for payment and the record that a sale happened, even if the cash hasn't arrived yet.",
  },
  'net 30': {
    term: 'Payment Terms (Net 30)',
    definition:
      "The deadline you give a customer to pay an invoice. 'Net 30' means payment is due within 30 days; 'Net 15' within 15. Longer terms are a courtesy to the customer but mean you wait longer for your cash.",
  },
};

// Aliases: abbreviations and common phrasings folded to a canonical glossary key. Keyed in the
// same normalized form defineTerm produces (lowercase, punctuation folded to spaces).
const ALIASES = {
  'pnl': 'profit and loss',
  'p l': 'profit and loss',
  'p and l': 'profit and loss',
  'income statement': 'profit and loss',
  'top line': 'revenue',
  'cogs': 'cost of goods sold',
  'cost of sales': 'cost of goods sold',
  'opex': 'operating expenses',
  'ar': 'accounts receivable',
  'receivables': 'accounts receivable',
  'ap': 'accounts payable',
  'payables': 'accounts payable',
  'capex': 'capital expenditure',
  'cash accounting': 'accrual accounting',
  'accrual': 'accrual accounting',
  'bottom line': 'net profit',
  'net income': 'net profit',
  'net margin': 'net profit',
  'operating profit': 'operating income',
  'margin': 'profit margin',
  'break even point': 'break even',
  'breakeven': 'break even',
  'variable costs': 'fixed costs',
  'fixed cost': 'fixed costs',
  'cac': 'customer acquisition cost',
  'ltv': 'lifetime value',
  'clv': 'lifetime value',
  'customer lifetime value': 'lifetime value',
  'ltv cac': 'ltv cac ratio',
  'ltv to cac': 'ltv cac ratio',
  'mrr': 'monthly recurring revenue',
  'arr': 'annual recurring revenue',
  'aov': 'average order value',
  'arpu': 'average revenue per user',
  'roi': 'return on investment',
  'roas': 'return on ad spend',
  'ctr': 'click through rate',
  'clickthrough rate': 'click through rate',
  'funnel': 'sales funnel',
  'pipeline': 'sales funnel',
  'marketing funnel': 'sales funnel',
  'cpm': 'cpm cpc cpa',
  'cpc': 'cpm cpc cpa',
  'cpa': 'cpm cpc cpa',
  'nps': 'net promoter score',
  'cross sell': 'upsell',
  'crm software': 'crm',
  'tam': 'total addressable market',
  'sam': 'serviceable addressable market',
  'som': 'serviceable obtainable market',
  'usp': 'unique selling proposition',
  'moat': 'competitive advantage',
  'pmf': 'product market fit',
  'mvp': 'minimum viable product',
  'gtm': 'go to market',
  'b2b': 'b2b b2c',
  'b2c': 'b2b b2c',
  'd2c': 'b2b b2c',
  'dtc': 'b2b b2c',
  'software as a service': 'saas',
  'moq': 'minimum order quantity',
  'gmv': 'gross merchandise value',
  'turnover': 'inventory turnover',
  'pre money': 'valuation',
  'post money': 'valuation',
  'captable': 'cap table',
  'vc': 'venture capital',
  'angel': 'angel investor',
  'limited liability company': 'llc',
  'net 15': 'net 30',
  'payment terms': 'net 30',
  'churn': 'churn rate',
  'retention': 'retention rate',
  'conversion': 'conversion rate',
  'click through': 'click through rate',
  'acquisition cost': 'customer acquisition cost',
  'recurring revenue': 'monthly recurring revenue',
  'diligence': 'due diligence',
  'market fit': 'product market fit',
  'gross': 'gross profit',
  'liquid': 'liquidity',
};

const LEADING = /^(what('?s| is| are| does)?|whats|define|explain|meaning of|the|a|an|tell me about|whats the|what is the|how does|hows)\s+/;

// Fold an input to the lookup form: lowercase, punctuation to spaces, common question filler
// stripped. Forgiving so a phrased question ("what does EBITDA mean?") still hits.
function normalizeTerm(input) {
  let s = String(input == null ? '' : input).toLowerCase().trim();
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(LEADING, '').trim();
  s = s.replace(/\s+(mean|means|meaning|defined|definition|stand for|work|works)$/, '').trim();
  return s;
}

// Look a term up. Returns the curated entry, or null when it isn't carried — the caller then
// lets Clay explain it in plain words as general knowledge, not as an authoritative definition.
function defineTerm(input) {
  const key = normalizeTerm(input);
  if (!key) return null;
  if (GLOSSARY[key]) return GLOSSARY[key];
  const aliased = ALIASES[key];
  if (aliased && GLOSSARY[aliased]) return GLOSSARY[aliased];
  return null;
}

// Every canonical term label, for a browse list or coverage checks.
function glossaryTerms() {
  return Object.values(GLOSSARY).map((e) => e.term);
}

// Count of carried terms — handy for a systems/health readout.
function glossarySize() {
  return Object.keys(GLOSSARY).length;
}

module.exports = { defineTerm, normalizeTerm, glossaryTerms, glossarySize, GLOSSARY, ALIASES };
