export function formatRupiahInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function parseRupiahInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? Number(digits) : null;
}

export function bindRupiahInput(input, onValue) {
  input.addEventListener('input', () => {
    const cursor = input.selectionStart ?? input.value.length;
    const digitsBeforeCursor = input.value.slice(0, cursor).replace(/\D/g, '').length;
    input.value = formatRupiahInput(input.value);

    let nextCursor = 0;
    let digitsSeen = 0;
    while (nextCursor < input.value.length && digitsSeen < digitsBeforeCursor) {
      if (/\d/.test(input.value[nextCursor])) digitsSeen++;
      nextCursor++;
    }
    input.setSelectionRange(nextCursor, nextCursor);
    onValue?.(parseRupiahInput(input.value));
  });
}
