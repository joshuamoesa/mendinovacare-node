// Translates Mendix expressions to JavaScript/TypeScript expressions.
// Pure function — no side effects.
// Unrecognised patterns fall back to: true // TODO: <original>

export function translateExpression(expr: string): string {
  if (!expr || !expr.trim()) return 'true /* TODO: empty condition */'

  let result = expr.trim()

  // ── Literals ────────────────────────────────────────────────────────────────
  result = result.replace(/\bempty\b/g, 'null')
  result = result.replace(/\$currentUser\b/g, "'mxadmin'")
  result = result.replace(/\$currentDateTime\b/g, 'new Date()')

  // ── Operators ───────────────────────────────────────────────────────────────
  // Must replace != before = so we don't double-process
  result = result.replace(/!=/g, '!==')
  // Single = for equality (not preceded by !, <, >, =)
  result = result.replace(/(?<![!<>=])=(?!=)/g, '===')
  result = result.replace(/\band\b/g, '&&')
  result = result.replace(/\bor\b/g, '||')

  // ── Built-in functions ───────────────────────────────────────────────────────
  result = result.replace(/\bnot\((.+?)\)/g, '!($1)')
  result = result.replace(/\btoLowerCase\(\$(\w+)\)/g, (_, v) => `${v}.toLowerCase()`)
  result = result.replace(/\btoUpperCase\(\$(\w+)\)/g, (_, v) => `${v}.toUpperCase()`)
  result = result.replace(/\blength\(\$(\w+)\)/g, (_, v) => `${v}.length`)
  result = result.replace(/\btrim\(\$(\w+)\)/g, (_, v) => `${v}.trim()`)
  result = result.replace(/\btoString\(\$(\w+)\)/g, (_, v) => `String(${v})`)
  result = result.replace(/\btoFloat\(\$(\w+)\)/g, (_, v) => `parseFloat(${v})`)
  result = result.replace(/\btoInteger\(\$(\w+)\)/g, (_, v) => `parseInt(${v})`)

  // ── Variable/attribute references ────────────────────────────────────────────
  // $Var/Assoc/Field — association traversal (3-part): emit a TODO comment
  result = result.replace(/\$(\w+)\/(\w+)\/(\w+)/g, (_, varName, assoc, field) => {
    const safeAssoc = assoc.charAt(0).toLowerCase() + assoc.slice(1)
    const safeField = field.charAt(0).toLowerCase() + field.slice(1)
    return `/* await prisma.${assoc.toLowerCase()}.findFirst({ where: { /* TODO: link ${varName} */ } }) */ ${safeAssoc}?.${safeField}`
  })

  // $Var/Field — simple attribute access (2-part)
  result = result.replace(/\$(\w+)\/(\w+)/g, (_, varName, field) => {
    const safeVar = varName.charAt(0).toLowerCase() + varName.slice(1)
    const safeField = field.charAt(0).toLowerCase() + field.slice(1)
    return `${safeVar}.${safeField}`
  })

  // Bare $Variable
  result = result.replace(/\$(\w+)/g, (_, varName) => {
    return varName.charAt(0).toLowerCase() + varName.slice(1)
  })

  // ── Sanity check: if result still looks like it has unhandled Mendix syntax ──
  // (contains $, unmatched brackets from Mendix) fall back to TODO comment
  if (/[^a-zA-Z0-9_.()\[\]{}'"`\s+\-*/%!&|<>=:?.,;]/.test(result) ||
      result.includes('$')) {
    return `true /* TODO: ${expr} */`
  }

  return result
}
