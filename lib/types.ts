// Mendix project from Projects API v2
export interface MendixProject {
  projectId: string
  name: string
  description: string
  account: string
  owner: string
  repositoryType: string  // 'git' | 'svn' | 'N/A'
  defaultBranch: string
  lastUpdated: string | null
  mendixVersion: string
  url: string
}

// Attribute type mapping
export type PrismaType = 'String' | 'Int' | 'Float' | 'Decimal' | 'Boolean' | 'DateTime'
export type TsType = 'string' | 'number' | 'boolean' | 'Date'

export interface MendixAttribute {
  name: string
  type: string           // SDK attribute type constructor name
  prismaType: PrismaType
  tsType: TsType
  isAutoNumber: boolean
  isEnumeration: boolean
  enumerationName?: string
}

export interface MendixAssociation {
  name: string
  targetEntityName: string
  targetModuleName: string
  type: 'one-to-many' | 'many-to-many' | 'one-to-one'
  owner: 'source' | 'target' | 'both'
}

export interface MendixEntity {
  name: string
  moduleName: string
  qualifiedName: string   // ModuleName.EntityName
  attributes: MendixAttribute[]
  associations: MendixAssociation[]
  isSystemEntity: boolean
}

// Microflow node types (mapped from SDK)
export type MicroflowNodeKind =
  | 'StartEvent'
  | 'EndEvent'
  | 'CreateObjectAction'
  | 'RetrieveAction'
  | 'ChangeObjectAction'
  | 'DeleteAction'
  | 'MicroflowCallAction'
  | 'LogMessageAction'
  | 'ShowMessageAction'
  | 'ExclusiveSplit'
  | 'ExclusiveMerge'
  | 'LoopedActivity'
  | 'ValidationFeedbackAction'
  | 'ChangeVariableAction'
  | 'Other'

export interface MicroflowNode {
  id: string
  kind: MicroflowNodeKind
  rawType: string
  entityName?: string
  targetMicroflow?: string
  expression?: string
  message?: string
  messageTemplate?: string   // ShowMessageAction popup text
  messageType?: string       // ShowMessageAction: 'Information' | 'Warning' | 'Error'
  feedbackAttribute?: string // ValidationFeedbackAction: attribute name being validated
  feedbackMessage?: string   // ValidationFeedbackAction: error message text
  outgoingFlows: string[]   // IDs of connected nodes
}

export interface MendixMicroflow {
  name: string
  moduleName: string
  qualifiedName: string
  parameters: Array<{ name: string; type: string }>
  nodes: MicroflowNode[]
  returnType?: string
}

// Page widget types
export type WidgetKind =
  | 'DataView'
  | 'ListView'
  | 'DataGrid'
  | 'TextBox'
  | 'TextArea'
  | 'Button'
  | 'Label'
  | 'Text'
  | 'Image'
  | 'Container'
  | 'Unknown'

export interface MendixWidget {
  kind: WidgetKind
  rawType: string
  name?: string
  caption?: string
  attributeName?: string
  entityName?: string
  microflowName?: string
  // Gap-filling fields extracted from appearance + image data
  imageRef?: string      // e.g. "design_module$Image_collection$headerImage"
  cssClass?: string      // appearance.class e.g. "img-cover img-center btn-warning btn-rounded"
  inlineStyle?: string   // appearance.style e.g. "height: 420px"
  children: MendixWidget[]
}

export interface MendixPage {
  name: string
  moduleName: string
  qualifiedName: string
  title?: string
  entityName?: string     // main data source entity
  widgets: MendixWidget[]
}

export interface MendixEnumeration {
  name: string
  moduleName: string
  qualifiedName: string
  values: string[]
}

// Full extracted model
export interface MendixAppModel {
  projectId: string
  projectName: string
  entities: MendixEntity[]
  enumerations: MendixEnumeration[]
  microflows: MendixMicroflow[]
  pages: MendixPage[]
  stats: {
    moduleCount: number
    entityCount: number
    enumerationCount: number
    microflowCount: number
    pageCount: number
  }
}

// Generated file
export interface GeneratedFile {
  path: string      // e.g. "prisma/schema.prisma"
  content: string
  category: 'data' | 'logic' | 'pages' | 'routes' | 'config'
}

// Tab grouping for the code viewer
export interface FileGroup {
  label: string
  category: GeneratedFile['category']
  files: GeneratedFile[]
}
