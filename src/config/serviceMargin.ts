// The margin of the company, put into the unit price that the price guidance (sunglasses, shoes, golf tees) shows.
//
// The base prices in the database stay the factory prices (listing medians or real factory quotes); the margin is
// applied only when a range is calculated, so the database can be read and corrected as factory prices. It is not shown
// as a line of its own: the range is an estimate, and the notice says what it leaves out (shipping, duty, mold, logo,
// packaging) and that the binding quote comes from the agent.
//
// 2026-11-16: 10 % for all three products (the owner's decision).
export const SERVICE_MARGIN_RATE = 0.1;

export const withServiceMargin = (value: number): number => value * (1 + SERVICE_MARGIN_RATE);
