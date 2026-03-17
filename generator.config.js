// Generator configuration for mendix-to-node
//
// Lists of Mendix model items to extract as a priority regardless of their
// position in the full list (which is capped to prevent excessive SDK calls).
//
// TODO — not yet implemented:
//   nanoflows      : Mendix nanoflows (client-side microflows)
//   snippets       : Reusable page snippets
//   publishedRest  : Published REST services (endpoints / operations)
//   scheduledEvents: Scheduled microflow invocations

module.exports = {
  // Mendix modules to skip during extraction.
  // 'System' and 'Administration' are Mendix built-ins with no app logic.
  // 'Marketplace' contains Atlas UI / helper widgets — rarely useful to generate.
  skipModules: [
    'System',
    'Administration',
    'Marketplace'
  ],

  priority: {
    microflows: [
      'ACT_ContactFormEntry_Submit'
    ],
    pages: [],
    entities: []
  }
}
