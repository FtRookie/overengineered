/** At most `max` bytes, cut on a character boundary. Bytes never undercount a UTF-16 length, so it also caps that */
export const clipBytes = (text: string, max: number): string => {
	if (text.size() <= max) return text;

	let cut = max;
	while (cut > 0) {
		// a continuation byte (10xxxxxx) right after the cut means the cut splits a character
		const [following] = text.byte(cut + 1);
		if (bit32.band(following, 0xc0) !== 0x80) break;
		cut--;
	}
	return text.sub(1, cut);
};
