/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'

import {
  MendixEntity,
  MendixAttribute,
  MendixAssociation,
  MendixMicroflow,
  MicroflowNode,
  MicroflowNodeKind,
  MendixPage,
  MendixWidget,
  WidgetKind,
  MendixAppModel,
  PrismaType,
  TsType,
  GeneratedFile
} from '../lib/types'

import { generateLayout } from '../generators/layoutGenerator'
import { generatePages, generateEntityRoutes } from '../generators/pageGenerator'
import { generateAppEntry, generateDbSingleton } from '../generators/appGenerator'
import { generatePrismaSchema } from '../generators/prismaGenerator'
import { generateMicroflowServices } from '../generators/microflowGenerator'
import { generatePackageJson, generateTsConfig, generateEnvExample, generateReadme } from '../generators/packageJsonGenerator'
import { generateTypes } from '../generators/typesGenerator'

// ─── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = '97e0e05a-f870-4c10-af86-7f960fe5a0bb'
const PROJECT_NAME = 'Mendinova Care'
const DEPLOYMENT_URL = 'https://mendinovacare.apps.eu-1c.mendixcloud.com'
const OUT_DIR = path.join(__dirname, '..', 'app')

// ─── Type mapping helpers ────────────────────────────────────────────────────

function mapAttributeType(typeName: string): { prismaType: PrismaType; tsType: TsType; isAutoNumber: boolean; isEnumeration: boolean } {
  switch (typeName) {
    case 'IntegerAttributeType':
      return { prismaType: 'Int', tsType: 'number', isAutoNumber: false, isEnumeration: false }
    case 'AutoNumberAttributeType':
      return { prismaType: 'Int', tsType: 'number', isAutoNumber: true, isEnumeration: false }
    case 'DecimalAttributeType':
    case 'FloatAttributeType':
      return { prismaType: 'Float', tsType: 'number', isAutoNumber: false, isEnumeration: false }
    case 'BooleanAttributeType':
      return { prismaType: 'Boolean', tsType: 'boolean', isAutoNumber: false, isEnumeration: false }
    case 'DateTimeAttributeType':
      return { prismaType: 'DateTime', tsType: 'Date', isAutoNumber: false, isEnumeration: false }
    case 'EnumerationAttributeType':
      return { prismaType: 'String', tsType: 'string', isAutoNumber: false, isEnumeration: true }
    default:
      return { prismaType: 'String', tsType: 'string', isAutoNumber: false, isEnumeration: false }
  }
}

function mapMicroflowNodeKind(typeName: string): MicroflowNodeKind {
  const kindMap: Record<string, MicroflowNodeKind> = {
    StartEvent: 'StartEvent',
    EndEvent: 'EndEvent',
    CreateObjectAction: 'CreateObjectAction',
    RetrieveAction: 'RetrieveAction',
    ChangeObjectAction: 'ChangeObjectAction',
    DeleteAction: 'DeleteAction',
    MicroflowCallAction: 'MicroflowCallAction',
    LogMessageAction: 'LogMessageAction',
    ExclusiveSplit: 'ExclusiveSplit',
    LoopedActivity: 'LoopedActivity',
  }
  return kindMap[typeName] || 'Other'
}

function mapWidgetKind(typeName: string): WidgetKind {
  if (typeName.includes('DataView')) return 'DataView'
  if (typeName.includes('ListView')) return 'ListView'
  if (typeName.includes('DataGrid')) return 'DataGrid'
  if (typeName.includes('TextBox')) return 'TextBox'
  if (typeName.includes('TextArea')) return 'TextArea'
  if (typeName.includes('ActionButton') || typeName.includes('Button')) return 'Button'
  if (typeName.includes('ImageViewer') || typeName.includes('StaticImage')) return 'Image'
  if (typeName.includes('Label')) return 'Label'
  if (typeName.includes('StaticText') || typeName.includes('Text')) return 'Text'
  if (typeName.includes('Container') || typeName.includes('LayoutGrid')) return 'Container'
  return 'Unknown'
}

// ─── Extraction functions ────────────────────────────────────────────────────

async function extractEntities(model: any): Promise<MendixEntity[]> {
  const entities: MendixEntity[] = []
  const SKIP_MODULES = new Set(['System', 'Administration', 'Marketplace'])

  try {
    const allModules = model.allModules()
    for (const mod of allModules) {
      try {
        const moduleName = mod.name || ''
        if (SKIP_MODULES.has(moduleName)) continue

        const domainModel = mod.domainModel
        if (!domainModel) continue
        await domainModel.load()

        const entityByName = new Map<string, MendixEntity>()
        for (const entity of domainModel.entities || []) {
          try {
            await entity.load()

            const attributes: MendixAttribute[] = []
            for (const attr of entity.attributes || []) {
              try {
                await attr.load()
                const typeName = attr.value?.constructor?.name || attr.attributeType?.constructor?.name || 'StringAttributeType'
                const mapped = mapAttributeType(typeName)
                attributes.push({
                  name: attr.name,
                  type: typeName,
                  ...mapped,
                  enumerationName: mapped.isEnumeration ? (attr.value?.enumeration?.name || attr.attributeType?.enumeration?.name) : undefined
                })
              } catch (_) { /* skip bad attribute */ }
            }

            const extracted: MendixEntity = {
              name: entity.name,
              moduleName,
              qualifiedName: entity.qualifiedName || `${moduleName}.${entity.name}`,
              attributes,
              associations: [],
              isSystemEntity: false
            }
            entities.push(extracted)
            entityByName.set(entity.name, extracted)
          } catch (_) { /* skip bad entity */ }
        }

        for (const assoc of domainModel.associations || []) {
          try {
            await assoc.load()
            const parentName: string = assoc.parent?.name || ''
            const targetQName: string = assoc.child?.qualifiedName || ''
            const targetParts = targetQName.split('.')
            const assocType: 'many-to-many' | 'one-to-many' =
              String(assoc.type || '').includes('ReferenceSet') ? 'many-to-many' : 'one-to-many'
            const parentEntity = entityByName.get(parentName)
            if (parentEntity) {
              parentEntity.associations.push({
                name: assoc.name,
                targetEntityName: targetParts[1] || targetQName,
                targetModuleName: targetParts[0] || '',
                type: assocType,
                owner: 'source'
              })
            }
          } catch (_) { /* skip bad association */ }
        }
      } catch (_) { /* skip bad module */ }
    }
  } catch (_) { /* if allModules fails */ }

  return entities
}

async function extractMicroflows(model: any): Promise<MendixMicroflow[]> {
  const microflows: MendixMicroflow[] = []
  const SKIP_MODULES = new Set(['System', 'Administration'])
  const MAX = 50

  try {
    const allMicroflows = model.allMicroflows()
    const limited = allMicroflows.slice(0, MAX)

    for (const mf of limited) {
      try {
        await mf.load()
        const moduleName = mf.qualifiedName?.split('.')?.[0] || ''
        if (SKIP_MODULES.has(moduleName)) continue

        const parameters: Array<{ name: string; type: string }> = []
        for (const param of mf.parameters || []) {
          try {
            await param.load()
            parameters.push({ name: param.name, type: param.type?.constructor?.name || 'any' })
          } catch (_) { /* skip */ }
        }

        const nodes: MicroflowNode[] = []

        try {
          const objects = mf.objectCollection?.objects || []
          for (const obj of objects) {
            try {
              await obj.load()
              const rawType = obj.constructor?.name || 'Unknown'
              const kind = mapMicroflowNodeKind(rawType)

              const node: MicroflowNode = {
                id: obj.id || String(Math.random()),
                kind,
                rawType,
                outgoingFlows: []
              }

              if (['CreateObjectAction', 'RetrieveAction', 'ChangeObjectAction', 'DeleteAction'].includes(kind)) {
                const entityRef = obj.entity || obj.entityRef
                if (entityRef) {
                  try {
                    const entityName = entityRef.qualifiedName?.split('.')?.[1] || entityRef.name || ''
                    node.entityName = entityName
                  } catch (_) { /* skip */ }
                }
              }

              if (kind === 'MicroflowCallAction') {
                try {
                  const calledMf = obj.microflowCall?.microflow
                  node.targetMicroflow = calledMf?.name || calledMf?.qualifiedName?.split('.')?.[1] || 'unknown'
                } catch (_) { /* skip */ }
              }

              if (kind === 'LogMessageAction') {
                try {
                  node.message = obj.message?.parts?.[0]?.value || ''
                } catch (_) { /* skip */ }
              }

              if (kind === 'ExclusiveSplit' || kind === 'EndEvent') {
                try {
                  node.expression = obj.splitCondition?.expression || obj.returnValue?.expression || ''
                } catch (_) { /* skip */ }
              }

              nodes.push(node)
            } catch (_) { /* skip bad node */ }
          }
        } catch (_) { /* skip if no objects */ }

        try {
          const flows = mf.flows || []
          for (const flow of flows) {
            try {
              await flow.load()
              const fromId = flow.origin?.id
              const toId = flow.destination?.id
              if (fromId && toId) {
                const fromNode = nodes.find(n => n.id === fromId)
                if (fromNode && !fromNode.outgoingFlows.includes(toId)) {
                  fromNode.outgoingFlows.push(toId)
                }
              }
            } catch (_) { /* skip */ }
          }
        } catch (_) { /* skip */ }

        microflows.push({
          name: mf.name,
          moduleName,
          qualifiedName: mf.qualifiedName || `${moduleName}.${mf.name}`,
          parameters,
          nodes,
          returnType: mf.returnType?.constructor?.name || undefined
        })
      } catch (_) { /* skip bad microflow */ }
    }
  } catch (_) { /* if allMicroflows fails */ }

  return microflows
}

async function extractWidgetTree(widget: any): Promise<MendixWidget> {
  try { await widget.load() } catch (_) { /* widget may not support load */ }

  const rawType = widget?.constructor?.name || 'Unknown'
  const kind = mapWidgetKind(rawType)

  const result: MendixWidget = {
    kind,
    rawType,
    name: widget?.name || undefined,
    caption: widget?.caption?.value || widget?.label?.value || widget?.name || undefined,
    attributeName: widget?.attributePath || widget?.attribute?.name || undefined,
    entityName: undefined,
    microflowName: undefined,
    children: []
  }

  // Extract appearance: CSS class, inline style, and design properties
  try {
    const appearance = widget?.appearance
    if (appearance) {
      try { await appearance.load() } catch (_) { /* skip */ }
      if (appearance.class) result.cssClass = appearance.class

      // Map Atlas design properties to CSS class names
      // e.g. ButtonStyle=Warning → btn-warning, ButtonStyle=Primary → btn-primary
      const designProps: Array<{ key: string; value: string }> = []
      try {
        for (const dp of appearance.designProperties || []) {
          try {
            await dp.load()
            if (dp.key && dp.value !== undefined) designProps.push({ key: dp.key, value: String(dp.value) })
          } catch (_) { /* skip */ }
        }
      } catch (_) { /* skip */ }

      const dpCssClasses: string[] = []
      for (const { key, value } of designProps) {
        const k = key.toLowerCase()
        const v = value.toLowerCase()
        // Button style → btn-{style}
        if (k.includes('buttonstyle') || k.includes('button-style') || k.includes('btn')) {
          if (v && v !== 'default') dpCssClasses.push(`btn-${v}`)
          else if (v === 'default') dpCssClasses.push('btn-default')
        }
        // Border/shape → btn-rounded etc.
        if (k.includes('border') || k.includes('shape')) {
          if (v.includes('round')) dpCssClasses.push('btn-rounded')
        }
        // Display as background image
        if ((k.includes('display') || k.includes('show')) && v.includes('background')) {
          dpCssClasses.push('mx-image-background', 'img-cover', 'img-center')
        }
      }
      if (dpCssClasses.length > 0) {
        result.cssClass = [result.cssClass, ...dpCssClasses].filter(Boolean).join(' ')
      }

      if (appearance.style) result.inlineStyle = appearance.style
    }
  } catch (_) { /* skip */ }

  // Extract image reference — runs for all widget kinds (including CustomWidget)
  if (!result.imageRef) {
    try {
      const imgObj = widget?.image
        || widget?.data?.image
        || widget?.imageSource?.image
        || widget?.defaultImage
      if (imgObj) {
        try { await imgObj.load() } catch (_) { /* skip */ }
        const qname = imgObj?.qualifiedName || imgObj?.name
        if (qname) {
          result.imageRef = String(qname).replace(/\./g, '$')
        }
      }
    } catch (_) { /* skip */ }
  }

  // Extract button captions via ClientTemplate.template (texts.Text).translations[0].text
  // SDK path: widget.caption (ClientTemplate) → .template (texts.Text) → .translations[i].text
  if (kind === 'Button' && (!result.caption || result.caption === widget?.name)) {
    try {
      const captionObj = widget?.caption                   // ClientTemplate
      if (captionObj) { try { await captionObj.load() } catch (_) { /* skip */ } }
      const textObj = captionObj?.template                 // texts.Text (NOT a string)
      if (textObj) { try { await textObj.load() } catch (_) { /* skip */ } }
      const translations = textObj?.translations
      if (Array.isArray(translations) && translations.length > 0) {
        const t = translations[0]
        if (t) { try { await t.load() } catch (_) { /* skip */ } }
        if (t && typeof t.text === 'string' && t.text) result.caption = t.text
      }
    } catch (_) { /* skip */ }
  }

  if (rawType === 'DynamicText') {
    try {
      const content = widget?.content
      if (content) { try { await content.load() } catch (_) { /* skip */ } }
      const template = content?.template
      if (template) { try { await template.load() } catch (_) { /* skip */ } }
      const translations = template?.translations
      if (Array.isArray(translations) && translations.length > 0) {
        const t = translations[0]
        if (t && typeof t.text === 'string' && t.text) {
          result.caption = t.text
        }
      }
    } catch (_) { /* skip */ }
  }

  try {
    if (widget?.dataSource) { try { await widget.dataSource.load() } catch (_) { /* skip */ } }
    const entityQName = widget?.dataSource?.entityQualifiedName
      || widget?.dataSource?.entityRef?.entityQualifiedName
      || widget?.dataSource?.entity?.qualifiedName
      || widget?.entity?.qualifiedName
      || widget?.entityPath
    if (entityQName) {
      result.entityName = String(entityQName).split('.')?.[1] || String(entityQName)
    }
  } catch (_) { /* skip */ }

  if (rawType === 'CustomWidget' && !result.entityName) {
    try {
      const obj = widget?.object
      if (obj) { try { await obj.load() } catch (_) { /* skip */ } }
      outer: for (const prop of obj?.properties || []) {
        try {
          await prop.load()
          const val = prop?.value
          if (!val) continue
          try { await val.load() } catch (_) { /* skip */ }

          if (val.entityRef) {
            try { await val.entityRef.load() } catch (_) { /* skip */ }
            const qname = val.entityRef?.entityQualifiedName || val.entityRef?.qualifiedName
            if (qname) { result.entityName = String(qname).split('.')?.[1] || String(qname); break outer }
          }

          if (val.dataSource) {
            try { await val.dataSource.load() } catch (_) { /* skip */ }
            const qname = val.dataSource?.entityQualifiedName
              || val.dataSource?.entityRef?.entityQualifiedName
              || val.dataSource?.entity?.qualifiedName
            if (qname) { result.entityName = String(qname).split('.')?.[1] || String(qname); break outer }
          }

          for (const nestedObj of val?.objects || []) {
            try {
              await nestedObj.load()
              for (const np of nestedObj?.properties || []) {
                try {
                  await np.load()
                  const nval = np?.value
                  if (!nval) continue
                  try { await nval.load() } catch (_) { /* skip */ }
                  if (nval.entityRef) {
                    try { await nval.entityRef.load() } catch (_) { /* skip */ }
                    const qname = nval.entityRef?.entityQualifiedName || nval.entityRef?.qualifiedName
                    if (qname) { result.entityName = String(qname).split('.')?.[1] || String(qname); break outer }
                  }
                  if (nval.dataSource) {
                    try { await nval.dataSource.load() } catch (_) { /* skip */ }
                    const qname = nval.dataSource?.entityQualifiedName
                      || nval.dataSource?.entityRef?.entityQualifiedName
                      || nval.dataSource?.entity?.qualifiedName
                    if (qname) { result.entityName = String(qname).split('.')?.[1] || String(qname); break outer }
                  }
                } catch (_) { /* skip */ }
              }
            } catch (_) { /* skip */ }
          }
        } catch (_) { /* skip */ }
      }
    } catch (_) { /* skip */ }
  }

  try {
    result.microflowName = widget?.action?.microflow?.name
      || widget?.onClickAction?.microflow?.name
  } catch (_) { /* skip */ }

  if (kind === 'DataGrid' && Array.isArray(widget?.columns)) {
    for (const col of widget.columns) {
      try { result.children.push(await extractWidgetTree(col)) } catch (_) { /* skip */ }
    }
  }

  if (Array.isArray(widget?.rows)) {
    // LayoutGrid: preserve row/column structure as nested Containers
    for (const row of widget.rows) {
      try { await row.load() } catch (_) { /* skip */ }
      const colWidgets: MendixWidget[] = []
      for (const col of row?.columns || []) {
        try { await col.load() } catch (_) { /* skip */ }
        const weight: number = (col as any)?.weight ?? 1
        const colChildren: MendixWidget[] = []
        for (const child of col?.widgets || []) {
          try { colChildren.push(await extractWidgetTree(child)) } catch (_) { /* skip */ }
        }
        if (colChildren.length > 0) {
          colWidgets.push({ kind: 'Container', rawType: 'LayoutGridColumn', cssClass: `mx-col mx-col-${weight}`, children: colChildren })
        }
      }
      if (colWidgets.length > 0) {
        result.children.push({ kind: 'Container', rawType: 'LayoutGridRow', cssClass: 'mx-row', children: colWidgets })
      }
    }
  } else {
    const stdSources = [
      widget?.widgets,
      widget?.containedWidgets,
      widget?.content?.widgets,
      widget?.footerWidgets
    ]
    for (const source of stdSources) {
      if (Array.isArray(source) && source.length > 0) {
        for (const child of source) {
          try { result.children.push(await extractWidgetTree(child)) } catch (_) { /* skip */ }
        }
        break
      }
    }
  }

  // Pluggable (CustomWidget) slot extraction: traverse widget.object.properties
  // looking for WidgetsPropertyValue slots (nested widget content) and image refs.
  // This fills the gap for Atlas image-background, cards, and other custom widgets.
  if (rawType === 'CustomWidget' && result.children.length === 0) {
    try {
      const obj = widget?.object
      if (obj) {
        try { await obj.load() } catch (_) { /* skip */ }

        let hasImageDisplayMode = false
        let heightPx: number | null = null
        let lastUnitIsPx = false

        for (const prop of (obj?.properties || [])) {
          try {
            await prop.load()
            const val = prop?.value
            if (!val) continue
            try { await val.load() } catch (_) { /* skip */ }

            // Widget content slot — add nested widgets as children
            if (Array.isArray(val?.widgets) && val.widgets.length > 0) {
              for (const child of val.widgets) {
                try { result.children.push(await extractWidgetTree(child)) } catch (_) { /* skip */ }
              }
            }

            // Image reference via WidgetValue.imageQualifiedName
            if (!result.imageRef) {
              try {
                const imgQName = val?.imageQualifiedName
                if (imgQName && typeof imgQName === 'string' && imgQName.includes('.')) {
                  result.imageRef = imgQName.replace(/\./g, '$')
                }
              } catch (_) { /* skip */ }
            }

            // Detect background display mode and height from primitiveValue
            try {
              const prim = val?.primitiveValue
              if (typeof prim === 'string') {
                if (prim === 'image') hasImageDisplayMode = true
                if (prim === 'pixels' || prim === 'px') lastUnitIsPx = true
                const numVal = parseFloat(prim)
                if (!isNaN(numVal) && numVal > 0 && lastUnitIsPx && heightPx === null) {
                  heightPx = numVal
                }
              }
            } catch (_) { /* skip */ }
          } catch (_) { /* skip */ }
        }

        // Apply background CSS classes and height when a background image is present
        if (result.imageRef && (hasImageDisplayMode || result.children.length > 0)) {
          const bgClasses = ['mx-image-background', 'img-cover', 'img-center']
          const existing = result.cssClass ? result.cssClass.split(' ') : []
          if (!existing.some(c => bgClasses.includes(c))) {
            result.cssClass = [...existing, ...bgClasses].filter(Boolean).join(' ')
          }
          if (heightPx !== null && !result.inlineStyle) {
            result.inlineStyle = `height: ${heightPx}px`
          }
        }
      }
    } catch (_) { /* skip */ }
  }

  return result
}

async function extractPages(model: any, entities: MendixEntity[] = []): Promise<MendixPage[]> {
  const pages: MendixPage[] = []
  const SKIP_MODULES = new Set(['System', 'Administration'])

  try {
    const allPages = model.allPages()
    const limited = allPages

    for (const page of limited) {
      try {
        await page.load()
        const moduleName = page.qualifiedName?.split('.')?.[0] || ''
        if (SKIP_MODULES.has(moduleName)) continue

        const widgets: MendixWidget[] = []
        try {
          const rawWidgets: any[] = []
          for (const arg of page.layoutCall?.arguments || []) {
            for (const w of arg?.widgets || []) {
              rawWidgets.push(w)
            }
          }
          const source = rawWidgets.length > 0 ? rawWidgets : (page.widgets || [])
          for (const widget of source) {
            try {
              widgets.push(await extractWidgetTree(widget))
            } catch (_) { /* skip */ }
          }
        } catch (_) { /* skip */ }

        let entityName: string | undefined
        const findEntity = (w: MendixWidget): string | undefined => {
          if (w.entityName) return w.entityName
          for (const c of w.children) {
            const found = findEntity(c)
            if (found) return found
          }
          return undefined
        }
        for (const w of widgets) {
          entityName = findEntity(w)
          if (entityName) break
        }

        if (!entityName && entities.length > 0) {
          const pageNameLower = page.name.toLowerCase()
          const matched = entities.find(e => pageNameLower.includes(e.name.toLowerCase()))
          if (matched) entityName = matched.name
        }

        pages.push({
          name: page.name,
          moduleName,
          qualifiedName: page.qualifiedName || `${moduleName}.${page.name}`,
          title: page.title?.value || page.name,
          entityName,
          widgets
        })
      } catch (_) { /* skip bad page */ }
    }
  } catch (_) { /* if allPages fails */ }

  return pages
}

// ─── File writer ─────────────────────────────────────────────────────────────

function writeGeneratedFile(outDir: string, file: GeneratedFile): void {
  const fullPath = path.join(outDir, file.path)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, file.content, 'utf8')
  console.log(`  wrote ${file.path}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pat = process.env.MENDIX_PAT
  const userId = process.env.MENDIX_USER_ID

  if (!pat || !userId) {
    console.error('Error: MENDIX_PAT and MENDIX_USER_ID must be set in .env')
    process.exit(1)
  }

  console.log(`Generating Node.js app for project ${PROJECT_ID}...`)
  console.log()

  // Load SDK via require to avoid module resolution issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MendixPlatformClient, setPlatformConfig } = require('mendixplatformsdk')
  setPlatformConfig({ mendixToken: pat })
  const client = new MendixPlatformClient()

  console.log('[1/5] Creating temporary working copy (30–120s)...')
  const app = client.getApp(PROJECT_ID)
  const workingCopy = await app.createTemporaryWorkingCopy('main')
  const model = await workingCopy.openModel()

  console.log('[2/5] Extracting domain model...')
  const entities = await extractEntities(model)
  const seenNames = new Set<string>()
  const userEntities = entities
    .filter(e => !e.isSystemEntity)
    .filter(e => { if (seenNames.has(e.name)) return false; seenNames.add(e.name); return true })
  const moduleCount = new Set(userEntities.map(e => e.moduleName)).size
  console.log(`      ${moduleCount} modules, ${userEntities.length} entities`)

  console.log('[3/5] Extracting microflows...')
  const microflows = await extractMicroflows(model)
  console.log(`      ${microflows.length} microflows`)

  console.log('[4/5] Extracting pages...')
  const pages = await extractPages(model, userEntities)
  console.log(`      ${pages.length} pages`)

  try { await model.closeConnection() } catch (_) { /* ignore */ }

  const appModel: MendixAppModel = {
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    entities: userEntities,
    microflows,
    pages,
    stats: { moduleCount, entityCount: userEntities.length, microflowCount: microflows.length, pageCount: pages.length }
  }

  console.log('[5/5] Generating files...')
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const files: GeneratedFile[] = [
    generateLayout(pages, PROJECT_NAME, DEPLOYMENT_URL),
    // Pass empty entities array — avoids generating include() calls for
    // navigation fields that don't exist in the FK-only schema.
    ...generatePages(pages, [], DEPLOYMENT_URL),
    ...generateEntityRoutes(userEntities),
    generateAppEntry(userEntities, pages),
    generateDbSingleton(),
    generatePrismaSchema(userEntities),
    ...generateMicroflowServices(microflows),
    generatePackageJson(PROJECT_NAME),
    generateTsConfig(),
    generateEnvExample(),
    generateReadme(PROJECT_NAME, appModel.stats),
    generateTypes(userEntities)
  ]

  for (const file of files) {
    writeGeneratedFile(OUT_DIR, file)
  }

  console.log()
  console.log(`Done! ${files.length} files written to app/`)
  console.log()
  console.log('Next steps:')
  console.log('  cd app')
  console.log('  cp .env.example .env')
  console.log('  npm install')
  console.log('  npm run db:push')
  console.log('  npm run dev')
  console.log('  → http://localhost:3001')
}

main().catch(err => {
  console.error('Fatal error:', err.message || err)
  process.exit(1)
})
