// Every signed market number carries a direction mark: ▲ when it is up, ▼ when it is down, nothing when flat.
// The mark follows the number as it is shown, so a move that rounds to zero gets no arrow.
// A no-break space keeps the arrow on the same line as its number.
export const UP_MARK = "▲ ";
export const DOWN_MARK = "▼ ";

export function arrow(value, places = 2) {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return "";
  const shown = Number(number.toFixed(places));
  return shown > 0 ? UP_MARK : shown < 0 ? DOWN_MARK : "";
}

/** "+1.25%" with its arrow in front: "▲ +1.25%". */
export const withArrow = (value, text, places = 2) => `${arrow(value, places)}${text}`;
