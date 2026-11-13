/**
 * The declarations an element takes on a touch screen, read from the
 * `@media (pointer: coarse)` rules the page holds for its classes and, inside
 * Chakra's `@layer base`, for the global elements. jsdom evaluates no media
 * query, so a test asserts the rule rather than a computed size. Test-only.
 */
export function coarsePointerStyle(element: Element): Record<string, string> {
  const style: Record<string, string> = {}
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of coarseRules(Array.from(sheet.cssRules))) {
      if (matches(element, rule.selectorText)) {
        for (const property of Array.from(rule.style)) {
          style[property] = rule.style.getPropertyValue(property)
        }
      }
    }
  }
  return style
}

function coarseRules(rules: CSSRule[]): CSSStyleRule[] {
  return rules.flatMap((rule) => {
    if (rule instanceof CSSMediaRule && rule.conditionText.includes('pointer: coarse')) {
      return Array.from(rule.cssRules).filter((inner) => inner instanceof CSSStyleRule)
    }
    if (rule instanceof CSSLayerBlockRule) return coarseRules(Array.from(rule.cssRules))
    return []
  })
}

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    // A selector jsdom cannot parse (a vendor pseudo-element) names no element here.
    return false
  }
}
