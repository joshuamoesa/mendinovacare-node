import { MendixMicroflow, MicroflowNode, GeneratedFile } from '../lib/types'
import { translateExpression } from '../lib/expressionTranslator'

function generateNodeStatement(node: MicroflowNode, indent: string): string {
  switch (node.kind) {
    case 'CreateObjectAction':
      return `${indent}const new${node.entityName || 'Object'} = await prisma.${(node.entityName || 'entity').toLowerCase()}.create({ data: {} })`

    case 'RetrieveAction':
      return `${indent}const ${(node.entityName || 'items').toLowerCase()}List = await prisma.${(node.entityName || 'entity').toLowerCase()}.findMany()`

    case 'ChangeObjectAction':
      return `${indent}await prisma.${(node.entityName || 'entity').toLowerCase()}.update({ where: { id: 0 /* TODO */ }, data: { /* TODO */ } })`

    case 'DeleteAction':
      return `${indent}await prisma.${(node.entityName || 'entity').toLowerCase()}.delete({ where: { id: 0 /* TODO */ } })`

    case 'MicroflowCallAction':
      return `${indent}await ${node.targetMicroflow || 'unknownMicroflow'}(/* TODO: params */)`

    case 'LogMessageAction':
      return `${indent}console.log(${node.message ? JSON.stringify(node.message) : '"TODO: log message"'})`

    case 'ShowMessageAction':
      return `${indent}// Show ${node.messageType || 'Information'} popup: ${node.messageTemplate ? JSON.stringify(node.messageTemplate) : '"TODO: message text"'}`

    case 'ExclusiveSplit': {
      const condition = node.expression ? translateExpression(node.expression) : 'true /* TODO: condition */'
      return `${indent}if (${condition}) {\n${indent}  // true branch\n${indent}} else {\n${indent}  // false branch\n${indent}}`
    }

    case 'ExclusiveMerge':
      return ''  // control-flow join node, nothing to emit

    case 'ValidationFeedbackAction': {
      const attr = node.feedbackAttribute || 'field'
      const msg = node.feedbackMessage || `${attr} is required`
      return `${indent}errors[${JSON.stringify(attr)}] = ${JSON.stringify(msg)}`
    }

    case 'ChangeVariableAction':
      return ''  // handled inside generateValidationFunction; skip in generic path

    case 'LoopedActivity':
      return `${indent}for (const item of items) {\n${indent}  // TODO: loop body\n${indent}}`

    case 'EndEvent':
      return node.expression
        ? `${indent}return ${translateExpression(node.expression)}`
        : `${indent}return`

    case 'StartEvent':
      return ''  // nothing to emit

    default:
      return `${indent}// TODO: ${node.rawType}`
  }
}

/**
 * Generates a structured validation function for microflows that contain
 * ValidationFeedbackAction nodes (typically prefixed VAL_).
 * Returns { valid: boolean, errors: Record<string, string> }.
 */
function generateValidationFunction(mf: MendixMicroflow): string {
  // Always ensure at least one parameter so the body can reference it.
  // The SDK sometimes fails to extract parameters for validation microflows.
  const paramName = mf.parameters[0]?.name || 'input'
  const params = mf.parameters.length > 0
    ? mf.parameters.map(p => `${p.name}: any`).join(', ')
    : `${paramName}: any`

  const feedbackNodes = mf.nodes.filter(n => n.kind === 'ValidationFeedbackAction')

  // Build one check per ValidationFeedbackAction node
  const checks = feedbackNodes.map(node => {
    const attr = node.feedbackAttribute || 'field'
    const msg = node.feedbackMessage || `${attr} is required`
    return `  if (!${paramName}.${attr}?.trim()) {\n    errors[${JSON.stringify(attr)}] = ${JSON.stringify(msg)}\n  }`
  })

  if (checks.length === 0) {
    checks.push('  // TODO: implement validation logic')
  }

  return `export function ${mf.name}(${params}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
${checks.join('\n')}
  return { valid: Object.keys(errors).length === 0, errors }
}`
}

function generateMicroflowFunction(mf: MendixMicroflow): string {
  // Route validation microflows to the dedicated generator
  const hasValidationNodes = mf.nodes.some(n => n.kind === 'ValidationFeedbackAction')
  if (mf.name.startsWith('VAL_') || hasValidationNodes) {
    return generateValidationFunction(mf)
  }

  const params = mf.parameters.map(p => `${p.name}: any`).join(', ')
  const returnType = mf.returnType ? ': Promise<any>' : ': Promise<void>'

  const statements: string[] = []

  for (const node of mf.nodes) {
    if (node.kind === 'StartEvent') continue
    const stmt = generateNodeStatement(node, '  ')
    if (stmt) statements.push(stmt)
  }

  if (statements.length === 0) {
    statements.push('  // TODO: implement microflow logic')
  }

  return `export async function ${mf.name}(${params})${returnType} {
${statements.join('\n')}
}`
}

export function generateMicroflowServices(microflows: MendixMicroflow[]): GeneratedFile[] {
  const MAX_MICROFLOWS = 200
  const limited = microflows.slice(0, MAX_MICROFLOWS)

  if (microflows.length > MAX_MICROFLOWS) {
    console.warn(`[microflowGenerator] Capped at ${MAX_MICROFLOWS} microflows (${microflows.length} total)`)
  }

  return limited.map(mf => {
    const isValidation = mf.name.startsWith('VAL_') || mf.nodes.some(n => n.kind === 'ValidationFeedbackAction')
    const header = isValidation
      ? `// Generated by mendix-to-node\n// Microflow: ${mf.qualifiedName}\n`
      : `// Generated by mendix-to-node\n// Microflow: ${mf.qualifiedName}\nimport { prisma } from '../db'\n`
    return {
      path: `src/services/${mf.name}.ts`,
      content: header + '\n' + generateMicroflowFunction(mf) + '\n',
      category: 'logic' as const
    }
  })
}
