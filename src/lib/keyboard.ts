type KeyEventLike = KeyboardEvent | { nativeEvent: KeyboardEvent };

/**
 * True while an input method editor (Chinese pinyin/zhuyin, Japanese kana,
 * Korean hangul, ...) owns the keystroke. Enter then confirms a candidate and
 * arrows move through candidates, so submit and history shortcuts must ignore
 * it. WebKit (the macOS webview) fires the confirming Enter after
 * `compositionend` with `isComposing` false, which keyCode 229 still catches.
 */
export function isImeComposing(event: KeyEventLike): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
