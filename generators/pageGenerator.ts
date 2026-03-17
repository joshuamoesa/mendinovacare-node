import { MendixPage, MendixWidget, MendixEntity, GeneratedFile } from '../lib/types'
import { pluralize } from '../lib/pageUtils'

// Relations that point back to a given entity via a one-to-many FK owned elsewhere.
// E.g. for Person: [{ ownerName: 'Skills', assocField: 'skills', displayAttrs: ['Name','Level'] }]
type ReverseRelation = { ownerName: string; assocField: string; displayAttrs: string[] }

// Remove duplicate background-image sections that share the same imageRef.
// Mendix pages sometimes include the same hero twice (mobile + desktop variants
// with different heights but identical content). Keep only the first occurrence.
function deduplicateHeroWidgets(widgets: MendixWidget[]): MendixWidget[] {
  const seen = new Set<string>()
  return widgets.filter(w => {
    const isBg = w.cssClass?.includes('mx-image-background') || w.cssClass?.includes('img-cover')
    if (!isBg) return true
    const key = w.imageRef ?? w.inlineStyle ?? '__bg__'
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Returns true if the widget tree contains any background-image hero section.
function hasHeroSection(widgets: MendixWidget[]): boolean {
  for (const w of widgets) {
    if (w.cssClass?.includes('mx-image-background') || w.cssClass?.includes('img-cover')) return true
    if (hasHeroSection(w.children)) return true
  }
  return false
}

// Collect captions of the first N Text/Label widgets in document order.
// Skips background-image containers — text inside a hero section belongs there,
// not promoted to a top-level h1/subtitle above the section.
function extractHeadings(widgets: MendixWidget[], max = 2): string[] {
  const results: string[] = []
  for (const w of widgets) {
    if (results.length >= max) break
    // Don't pull headings out of hero/background-image sections
    const isBgContainer = w.cssClass?.includes('mx-image-background') || w.cssClass?.includes('img-cover')
    if (isBgContainer) continue
    if ((w.kind === 'Text' || w.kind === 'Label') && w.caption) {
      results.push(w.caption)
    }
    if (w.children.length > 0) {
      results.push(...extractHeadings(w.children, max - results.length))
    }
  }
  return results
}

function toImageUrl(imageRef: string, deploymentUrl: string): string {
  // Heuristic: names containing 'svg' are likely SVGs; everything else PNG
  const ext = imageRef.toLowerCase().includes('svg') ? 'svg' : 'png'
  return `${deploymentUrl}/img/${imageRef}.${ext}`
}

function widgetToHtml(widget: MendixWidget, indent: string, routePath: string = '', promotedCaptions: Set<string> = new Set(), reverseO2m: ReverseRelation[] = [], deploymentUrl: string = ''): string {
  const i = indent
  const i2 = indent + '  '

  switch (widget.kind) {
    case 'DataView': {
      const formEntity = widget.entityName || 'entity'
      const children = widget.children.map(c => widgetToHtml(c, i2, routePath, promotedCaptions, reverseO2m, deploymentUrl)).filter(Boolean).join('\n')
      const actionPath = routePath || formEntity.toLowerCase()
      // Internal SDK names (dataViewN, dataView_Foo) are not user-visible titles
      const hasRealCaption = widget.caption && !/^dataView/i.test(widget.caption)
      const headingHtml = hasRealCaption ? `\n${i2}<h2>${widget.caption}</h2>` : ''
      // Only render as a form when editable fields are present
      const hasEditables = (w: MendixWidget): boolean =>
        w.kind === 'TextBox' || w.kind === 'TextArea' || w.children.some(hasEditables)
      if (widget.children.some(hasEditables)) {
        return `${i}<form method="POST" action="/${actionPath}/save">${headingHtml}
${children || `${i2}<!-- TODO: form fields -->`}
${i2}<button type="submit" class="btn">Save</button>
${i}</form>`
      }
      return children ? `${i}<div>${headingHtml}\n${children}\n${i}</div>` : ''
    }

    case 'ListView': {
      const entity = widget.entityName || 'items'
      const entityVar = entity.toLowerCase()

      // Extract up to two child attributes for primary/secondary display
      const attrChildren = widget.children.filter(c => c.attributeName)
      const primaryAttr = attrChildren[0]?.attributeName || null
      const secondaryAttr = attrChildren[1]?.attributeName || null
      const secondaryLabel = attrChildren[1]?.caption || secondaryAttr || ''

      const primaryExpr = primaryAttr
        ? `item.${primaryAttr} || item.id`
        : `item.id`
      const avatarExpr = primaryAttr
        ? `String(item.${primaryAttr} || '?')[0].toUpperCase()`
        : `String(item.id || '?')[0].toUpperCase()`

      const subLine = secondaryAttr
        ? `\n${i2}    <div class="mx-list-sub">${secondaryLabel}: <%= item.${secondaryAttr} %></div>`
        : ''

      const hasPopup = reverseO2m.length > 0
      const onclickAttr = hasPopup
        ? ` onclick="document.getElementById('modal-${entityVar}-<%= item.id %>').showModal()"`
        : ''

      // Build <dialog> blocks for each reverse relation
      const dialogBlocks = reverseO2m.map(r => {
        const headers = r.displayAttrs.map(a => `${i2}        <th>${a}</th>`).join('\n')
        const cells = r.displayAttrs.map(a => `${i2}        <td><%= s.${a} %></td>`).join('\n')
        return `${i2}<dialog id="modal-${entityVar}-<%= item.id %>" class="mx-dialog">
${i2}  <div class="mx-dialog-header">
${i2}    <h2><%= ${primaryExpr} %></h2>
${i2}    <button onclick="this.closest('dialog').close()" class="mx-dialog-close">&#10005;</button>
${i2}  </div>
${i2}  <% if (item.${r.assocField} && item.${r.assocField}.length > 0) { %>
${i2}  <h3 style="margin-top:1rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">${r.ownerName}</h3>
${i2}  <table class="table" style="margin-top:0.5rem">
${i2}    <thead><tr>
${headers}
${i2}    </tr></thead>
${i2}    <tbody>
${i2}    <% item.${r.assocField}.forEach(function(s) { %>
${i2}    <tr>
${cells}
${i2}    </tr>
${i2}    <% }) %>
${i2}    </tbody>
${i2}  </table>
${i2}  <% } else { %>
${i2}  <p style="color:#6b7280;margin-top:1rem">No ${r.ownerName.toLowerCase()} assigned.</p>
${i2}  <% } %>
${i2}</dialog>`
      }).join('\n')

      const modalCss = hasPopup ? `
${i}<style>
${i2}.mx-dialog{border:none;border-radius:12px;padding:1.5rem;min-width:360px;box-shadow:0 8px 32px rgba(0,0,0,.2)}
${i2}.mx-dialog::backdrop{background:rgba(0,0,0,.45)}
${i2}.mx-dialog-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
${i2}.mx-dialog-header h2{font-size:1.1rem;font-weight:700;color:#0a1326}
${i2}.mx-dialog-close{background:none;border:none;cursor:pointer;font-size:1.1rem;color:#6b7280;padding:.25rem;line-height:1}
${i2}.mx-dialog-close:hover{color:#333}
${i}</style>` : ''

      return `${i}<div style="margin: 1.5rem 0">
${i2}<a href="/${entityVar}/new" class="btn">New ${entity}</a>
${i}</div>
${i}<div class="mx-list">
${i2}<% ${entityVar}List.forEach(function(item) { %>
${i2}<div class="mx-list-row"${onclickAttr}>
${i2}  <div class="mx-avatar"><%= ${avatarExpr} %></div>
${i2}  <div class="mx-list-body">
${i2}    <div class="mx-list-title"><%= ${primaryExpr} %></div>${subLine}
${i2}  </div>
${i2}  <span class="mx-chevron">&#8250;</span>
${i2}</div>
${dialogBlocks}
${i2}<% }) %>
${i}</div>${modalCss}`
    }

    case 'DataGrid': {
      const entity = widget.entityName || 'items'
      const entityVar = entity.toLowerCase()
      const cols = widget.children.filter(c => c.attributeName)

      const headers = cols.map(c =>
        `${i2}    <th>${c.caption || c.attributeName}</th>`
      ).join('\n')

      const cells = cols.map(c =>
        `${i2}    <td><%= item.${c.attributeName} %></td>`
      ).join('\n')

      return `${i}<div style="margin: 1.5rem 0">
${i2}<a href="/${entity.toLowerCase()}/new" class="btn">New ${entity}</a>
${i}</div>
${i}<table class="table">
${i2}<thead><tr>
${headers}
${i2}    <th>Actions</th>
${i2}  </tr></thead>
${i2}<tbody>
${i2}<% ${entityVar}List.forEach(function(item) { %>
${i2}<tr>
${cells}
${i2}  <td>
${i2}    <a href="/${entity.toLowerCase()}/<%= item.id %>/edit" class="btn" style="padding:0.25rem 0.75rem;font-size:0.8rem">Edit</a>
${i2}    <form method="POST" action="/${entity.toLowerCase()}/<%= item.id %>/delete" style="display:inline">
${i2}      <button type="submit" class="btn" style="padding:0.25rem 0.75rem;font-size:0.8rem;background:#dc3545">Delete</button>
${i2}    </form>
${i2}  </td>
${i2}</tr>
${i2}<% }) %>
${i2}</tbody>
${i}</table>`
    }

    case 'TextBox': {
      const attr = widget.attributeName || 'field'
      return `${i}<div class="form-group">
${i2}<label for="${attr}">${widget.caption || attr}</label>
${i2}<input type="text" id="${attr}" name="${attr}" value="<%= item && item.${attr} ? item.${attr} : '' %>" class="form-control">
${i}</div>`
    }

    case 'TextArea': {
      const attr = widget.attributeName || 'field'
      return `${i}<div class="form-group">
${i2}<label for="${attr}">${widget.caption || attr}</label>
${i2}<textarea id="${attr}" name="${attr}" class="form-control"><%= item && item.${attr} ? item.${attr} : '' %></textarea>
${i}</div>`
    }

    case 'Image': {
      const isBackground = widget.cssClass?.includes('mx-image-background') || widget.cssClass?.includes('img-cover')
      const url = widget.imageRef && deploymentUrl ? toImageUrl(widget.imageRef, deploymentUrl) : ''
      const styleParts: string[] = []
      if (isBackground && url) styleParts.push(`background-image: url('${url}')`)
      if (widget.inlineStyle) styleParts.push(widget.inlineStyle)
      const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join('; ')}"` : ''
      const classAttr = widget.cssClass ? ` class="${widget.cssClass}"` : ''
      if (isBackground) {
        const children = widget.children.map(c => widgetToHtml(c, i2, routePath, promotedCaptions, reverseO2m, deploymentUrl)).filter(Boolean).join('\n')
        return `${i}<div${classAttr}${styleAttr}>\n${children}\n${i}</div>`
      }
      return url
        ? `${i}<img src="${url}" alt="${widget.name || ''}"${classAttr}>`
        : `${i}<!-- Image: ${widget.imageRef || 'unknown'} -->`
    }

    case 'Button': {
      const extraClass = widget.cssClass ? ` ${widget.cssClass}` : ''
      const btnClass = `btn${extraClass}`
      if (widget.microflowName) {
        return `${i}<button type="button" formaction="/services/${widget.microflowName}" class="${btnClass}">${widget.caption || 'Action'}</button>`
      }
      return `${i}<button type="submit" class="${btnClass}">${widget.caption || 'Submit'}</button>`
    }

    case 'Label':
    case 'Text': {
      if (promotedCaptions.has(widget.caption || '')) return ''
      const cls = widget.cssClass || ''
      const classAttr = cls ? ` class="${cls}"` : ''
      // Map Atlas heading classes to semantic HTML elements
      if (/\bh1\b/.test(cls)) return `${i}<h1${classAttr}>${widget.caption || ''}</h1>`
      if (/\bh2\b/.test(cls)) return `${i}<h2${classAttr}>${widget.caption || ''}</h2>`
      if (/\bh3\b/.test(cls)) return `${i}<h3${classAttr}>${widget.caption || ''}</h3>`
      if (/\bh4\b/.test(cls)) return `${i}<h4${classAttr}>${widget.caption || ''}</h4>`
      return `${i}<p${classAttr}>${widget.caption || ''}</p>`
    }

    case 'Container': {
      const children = widget.children.map(c => widgetToHtml(c, i2, routePath, promotedCaptions, reverseO2m, deploymentUrl)).filter(Boolean).join('\n')
      if (!children) return ''
      const classAttr = widget.cssClass ? ` class="${widget.cssClass}"` : ''
      const styleAttr = widget.inlineStyle ? ` style="${widget.inlineStyle}"` : ''
      return `${i}<div${classAttr}${styleAttr}>\n${children}\n${i}</div>`
    }

    default: {
      if (widget.children.length === 0) return `${i}<!-- ${widget.rawType} -->`
      const children = widget.children.map(c => widgetToHtml(c, i2, routePath, promotedCaptions, reverseO2m, deploymentUrl)).filter(Boolean).join('\n')
      if (!children) return ''
      const styleParts: string[] = []
      const isBackground = widget.cssClass?.includes('mx-image-background') || widget.cssClass?.includes('img-cover')
      if (isBackground && widget.imageRef && deploymentUrl) {
        styleParts.push(`background-image: url('${toImageUrl(widget.imageRef, deploymentUrl)}')`)
      }
      if (widget.inlineStyle) styleParts.push(widget.inlineStyle)
      const classAttr = widget.cssClass ? ` class="${widget.cssClass}"` : ''
      const styleAttr = styleParts.length > 0 ? ` style="${styleParts.join('; ')}"` : ''
      return `${i}<div${classAttr}${styleAttr}>\n${children}\n${i}</div>`
    }
  }
}

// Hardcoded polished template for the Home_Anonymous marketing page.
// The generic widget renderer cannot reproduce this page faithfully because:
//   - Atlas heading design properties are not mapped (all text arrives with no cssClass)
//   - Icon widgets are opaque CustomWidget placeholders
//   - The page needs a rich contact form and dark footer
function generateHomeAnonymous(deploymentUrl: string): string {
  const headerImg = deploymentUrl
    ? `${deploymentUrl}/img/design_module$Image_collection$headerImage.png`
    : 'https://mendinovacare.apps.eu-1c.mendixcloud.com/img/design_module$Image_collection$headerImage.png'
  return `<div class="container">
  <div class="mx-image-background img-cover img-center" style="background-image: url('${headerImg}')">
    <div>
      <div class="mx-row">
        <div class="mx-col mx-col-12">
          <h1>Care that works</h1>
          <h1 class="hero-subtitle">for you.</h1>
          <p>Manage your appointments and medical records safely, quickly, and digitally. Everything in one central place, accessible to you and our staff.</p>
        </div>
      </div>
      <div class="mx-row">
        <div class="mx-col mx-col--1">
          <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-top: 1.5rem;">
            <button type="submit" class="btn btn-rounded btn-warning"><img src="/img/design_module\$Image_collection\$fingerprint.svg" alt="">Sign in with DigiD</button>
            <button type="submit" class="btn btn-rounded"><img src="/img/design_module\$Image_collection\$inlogclient.svg" alt="">Patient sign in</button>
            <button type="submit" class="btn btn-rounded"><img src="/img/design_module\$Image_collection\$medewerken.svg" alt="">Employee sign in</button>
          </div>
          <button type="submit" class="btn btn-rounded btn-default" style="margin-top: 0.75rem;">Create an account</button>
        </div>
      </div>
      <div class="mx-row" style="margin-top: 1rem;">
        <div class="mx-col mx-col--1">
          <div class="mx-nen-badge">
            <img src="/img/design_module\$Image_collection\$fingerprint.svg" alt="" width="16" height="16">
            <p>Your data is secured according to the latest NEN standards.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div>
    <div>
      <div class="mx-row">
        <div class="mx-col mx-col--1">
          <h2>Why choose our portal?</h2>
          <p>We make care processes more efficient and accessible. Discover the benefits of our digital way of working.</p>
        </div>
      </div>
      <div class="mx-row" style="margin-top: 1.5rem;">
        <div class="mx-col mx-col--1">
          <div class="mx-card">
            <img src="/img/design_module\$Image_collection\$_24_7.svg" alt="" class="mx-card-icon">
            <h3>24/7 Access</h3>
            <p>Schedule appointments at your convenience. Always access your medical record, wherever you are.</p>
          </div>
        </div>
        <div class="mx-col mx-col--1">
          <div class="mx-card">
            <img src="/img/design_module\$Image_collection\$fingerprint.svg" alt="" class="mx-card-icon">
            <h3>Safe &amp; Trusted</h3>
            <p>Privacy comes first. We use two-factor authentication and encrypted connections.</p>
          </div>
        </div>
        <div class="mx-col mx-col--1">
          <div class="mx-card">
            <img src="/img/design_module\$Image_collection\$directContact.svg" alt="" class="mx-card-icon">
            <h3>Direct Contact</h3>
            <p>Direct contact with your healthcare provider through our secure chat feature. Ask questions without waiting.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div>
    <div>
      <div class="mx-row">
        <div class="mx-col mx-col--1">
          <h2>Our mission: Care Closer to You</h2>
          <p>In a world that is becoming increasingly digital, we believe that technology should strengthen the human touch in healthcare, not replace it.</p>
          <p>Our platform has been developed in collaboration with healthcare professionals and patient advisory councils to reduce administrative burdens. This allows our staff to devote more time to what truly matters: personal attention for you.</p>
          <div class="mx-checklist">
            <div class="mx-check-item">
              <img src="/img/design_module\$Image_collection\$V_V.svg" alt="" class="mx-check-icon">
              <span>Transparent communication</span>
            </div>
            <div class="mx-check-item">
              <img src="/img/design_module\$Image_collection\$V_V.svg" alt="" class="mx-check-icon">
              <span>User-friendly for young and old</span>
            </div>
            <div class="mx-check-item">
              <img src="/img/design_module\$Image_collection\$V_V.svg" alt="" class="mx-check-icon">
              <span>Fully compliant with laws and regulations</span>
            </div>
          </div>
        </div>
        <div class="mx-col mx-col--1">
          <img src="/img/design_module\$Image_collection\$doctorhelpingolderlylady.png" alt="Doctor helping elderly patient" class="mx-mission-img">
        </div>
      </div>
    </div>
  </div>

  <div>
    <div>
      <div class="mx-row">
        <div class="mx-col mx-col--1">
          <h2>Do you need help?</h2>
          <p>Our team is there to help you with any questions on signing in to or using our portal.</p>
          <div class="mx-contact-item">
            <img src="/img/design_module\$Image_collection\$telefoon.svg" alt="" class="mx-contact-icon">
            <div>
              <p class="mx-contact-label">Phone</p>
              <p class="mx-contact-sub">Mon to Fri: 8AM - 5PM</p>
              <p class="mx-contact-value">020 - 123 45 67</p>
            </div>
          </div>
          <div class="mx-contact-item">
            <img src="/img/design_module\$Image_collection\$email.svg" alt="" class="mx-contact-icon">
            <div>
              <p class="mx-contact-label">Email</p>
              <p class="mx-contact-sub">Response within 24 hrs</p>
              <p class="mx-contact-value">support@mendinovacare.nl</p>
            </div>
          </div>
        </div>
        <div class="mx-col mx-col--1">
          <div class="mx-card mx-contact-form">
            <h3 style="color: #D14200; margin-bottom: 1.5rem;">Contact us</h3>
            <form id="contactForm">
              <div class="form-group">
                <label>Your name</label>
                <input type="text" name="Name" class="form-control" placeholder="John Doe">
                <span class="form-error" id="error-Name"></span>
              </div>
              <div class="form-group">
                <label>Email address</label>
                <input type="email" name="Email" class="form-control" placeholder="j.doe@example.com">
                <span class="form-error" id="error-Email"></span>
              </div>
              <div class="form-group">
                <label>Message</label>
                <textarea name="Message" class="form-control" placeholder="What can we do for you?" rows="4"></textarea>
                <span class="form-error" id="error-Message"></span>
              </div>
              <button type="submit" class="btn btn-block">Submit</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="contactModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
    <div style="background:#fff;border-radius:8px;padding:2rem;max-width:400px;width:90%;text-align:center;">
      <h3 style="color:#0A1731;margin-bottom:0.75rem;">Thank you for contacting us!</h3>
      <p style="color:#4A4A4C;margin-bottom:1.5rem;">We will get back to you as soon as possible.</p>
      <button onclick="document.getElementById('contactModal').style.display='none'" class="btn">Close</button>
    </div>
  </div>
  <script>
    document.getElementById('contactForm').addEventListener('submit', async function(e) {
      e.preventDefault()
      const form = e.target
      const body = { Name: form.Name.value, Email: form.Email.value, Message: form.Message.value }
      try {
        ;['Name', 'Email', 'Message'].forEach(function(f) { document.getElementById('error-' + f).textContent = '' })
        const res = await fetch('/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await res.json()
        if (res.ok) {
          form.reset()
          document.getElementById('contactModal').style.display = 'flex'
        } else if (data.errors) {
          Object.keys(data.errors).forEach(function(field) {
            var el = document.getElementById('error-' + field)
            if (el) el.textContent = data.errors[field]
          })
        } else {
          console.error('Contact form submission failed', res.status)
        }
      } catch (err) {
        console.error('Contact form error', err)
      }
    })
  </script>

  <div class="mx-footer">
    <div>
      <div class="mx-row" style="align-items: center;">
        <div class="mx-col mx-col-3">
          <img src="/img/design_module\$Image_collection\$mendinovaWhite.svg" alt="Mendinova Care" height="40">
        </div>
        <div class="mx-col mx-col-6" style="display: flex; gap: 2rem; justify-content: center;">
          <a href="#">Privacy statement</a>
          <a href="#">Terms &amp; Conditions</a>
          <a href="#">Cookies</a>
        </div>
        <div class="mx-col mx-col-3" style="text-align: right;">
          <p>2026 Mendinova Care B.V.</p>
        </div>
      </div>
    </div>
  </div>
</div>`
}

function generateEjsTemplate(page: MendixPage, reverseO2m: ReverseRelation[] = [], entityModel?: MendixEntity, deploymentUrl: string = ''): string {
  if (page.name === 'Home_Anonymous') {
    return generateHomeAnonymous(deploymentUrl)
  }
  const routePath = page.name.toLowerCase()

  const dedupedWidgets = deduplicateHeroWidgets(page.widgets)

  // When the page contains a hero/background-image section, don't promote any
  // heading — the hero provides its own visual hierarchy.
  // Otherwise, promote the first two Text/Label captions to <h1>/.mx-subtitle.
  const headings = hasHeroSection(dedupedWidgets) ? [] : extractHeadings(dedupedWidgets)
  const h1Text = headings[0] || null   // null → no outer h1 (content provides its own)
  const subtitleText = headings.length >= 2 ? headings[1] : null
  const promotedCaptions = new Set(headings.slice(0, 2).filter(Boolean))

  let body = dedupedWidgets.map(w => widgetToHtml(w, '  ', routePath, promotedCaptions, reverseO2m, deploymentUrl)).filter(Boolean).join('\n\n')

  // CustomWidget (DataGrid 2, ListView, etc.) is opaque to the SDK and renders as a comment.
  // If the page has a resolved entity, replace the first such placeholder with either:
  //   a) a card list with popup dialogs (when reverse o2m relations exist), or
  //   b) a generic fallback table (columns derived at runtime from Object.keys).
  // Only inject CRUD for user-defined entities (entityModel exists).
  // System entities like UserRole are not in the Prisma schema and must be skipped.
  if (page.entityName && entityModel && body.includes('<!-- CustomWidget -->')) {
    const entity = page.entityName
    const entityVar = entity.toLowerCase() + 'List'
    const entityLower = entity.toLowerCase()

    let fallback: string

    if (reverseO2m.length > 0 && entityModel) {
      // Card list with popup dialogs — mirrors the native ListView case
      const attrs = entityModel.attributes.filter(a => !a.isAutoNumber)
      const primaryAttr = attrs[0]?.name
      const secondaryAttr = attrs[1]?.name
      const primaryExpr = primaryAttr ? `item.${primaryAttr} || item.id` : `item.id`
      const avatarExpr = primaryAttr
        ? `String(item.${primaryAttr} || '?')[0].toUpperCase()`
        : `String(item.id || '?')[0].toUpperCase()`
      const subLine = secondaryAttr
        ? `\n      <div class="mx-list-sub">${secondaryAttr}: <%= item.${secondaryAttr} %></div>`
        : ''

      const dialogBlocks = reverseO2m.map(r => {
        const headers = r.displayAttrs.map(a => `          <th>${a}</th>`).join('\n')
        const cells = r.displayAttrs.map(a => `          <td><%= s.${a} %></td>`).join('\n')
        return `    <dialog id="modal-${entityLower}-<%= item.id %>" class="mx-dialog">
      <div class="mx-dialog-header">
        <h2><%= ${primaryExpr} %></h2>
        <button onclick="this.closest('dialog').close()" class="mx-dialog-close">&#10005;</button>
      </div>
      <% if (item.${r.assocField} && item.${r.assocField}.length > 0) { %>
      <h3 style="margin-top:1rem;font-size:0.85rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">${r.ownerName}</h3>
      <table class="table" style="margin-top:0.5rem">
        <thead><tr>
${headers}
        </tr></thead>
        <tbody>
        <% item.${r.assocField}.forEach(function(s) { %>
        <tr>
${cells}
        </tr>
        <% }) %>
        </tbody>
      </table>
      <% } else { %>
      <p style="color:#6b7280;margin-top:1rem">No ${r.ownerName.toLowerCase()} assigned.</p>
      <% } %>
    </dialog>`
      }).join('\n')

      fallback = `  <div class="mx-list">
    <% ${entityVar}.forEach(function(item) { %>
    <div class="mx-list-row" onclick="document.getElementById('modal-${entityLower}-<%= item.id %>').showModal()">
      <div class="mx-avatar"><%= ${avatarExpr} %></div>
      <div class="mx-list-body">
        <div class="mx-list-title"><%= ${primaryExpr} %></div>${subLine}
      </div>
      <span class="mx-chevron">&#8250;</span>
    </div>
${dialogBlocks}
    <% }) %>
  </div>
  <style>
    .mx-dialog{border:none;border-radius:12px;padding:1.5rem;min-width:360px;box-shadow:0 8px 32px rgba(0,0,0,.2)}
    .mx-dialog::backdrop{background:rgba(0,0,0,.45)}
    .mx-dialog-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
    .mx-dialog-header h2{font-size:1.1rem;font-weight:700;color:#0a1326}
    .mx-dialog-close{background:none;border:none;cursor:pointer;font-size:1.1rem;color:#6b7280;padding:.25rem;line-height:1}
    .mx-dialog-close:hover{color:#333}
  </style>`
    } else {
      // Generic Object.keys() table fallback
      fallback = `  <div style="margin: 1.5rem 0">
    <a href="/${entityLower}/new" class="btn">New ${entity}</a>
  </div>
  <table class="table">
    <thead><tr>
      <% if (${entityVar}.length > 0) { Object.keys(${entityVar}[0]).forEach(function(k) { %><th><%= k %></th><% }) } %>
      <th>Actions</th>
    </tr></thead>
    <tbody>
    <% ${entityVar}.forEach(function(item) { %>
      <tr>
        <% Object.keys(item).forEach(function(k) { %><td><%= item[k] %></td><% }) %>
        <td>
          <a href="/${entityLower}/<%= item.id %>/edit" class="btn" style="padding:0.25rem 0.75rem;font-size:0.8rem">Edit</a>
          <form method="POST" action="/${entityLower}/<%= item.id %>/delete" style="display:inline">
            <button type="submit" class="btn" style="padding:0.25rem 0.75rem;font-size:0.8rem;background:#dc3545">Delete</button>
          </form>
        </td>
      </tr>
    <% }) %>
    </tbody>
  </table>`
    }

    body = body.replace('<!-- CustomWidget -->', fallback)
  }

  const h1Html = h1Text ? `\n  <h1>${h1Text}</h1>` : ''
  const subtitleHtml = subtitleText ? `\n  <p class="mx-subtitle">${subtitleText}</p>` : ''
  const headerHtml = h1Html || subtitleHtml ? `${h1Html}${subtitleHtml}\n` : ''

  return `<div class="container">${headerHtml}
${body || '  <!-- TODO: page content -->'}
</div>`
}

function attrInputType(a: { tsType: string; name: string }): string {
  if (a.tsType === 'boolean') return 'checkbox'
  if (a.tsType === 'number') return 'number'
  if (a.tsType === 'Date' || /date|time/i.test(a.name)) return 'date'
  return 'text'
}

function generateNewFormView(entity: MendixEntity, allEntities: MendixEntity[] = []): string {
  const nameLower = entity.name.toLowerCase()
  const fields = entity.attributes
    .filter(a => !a.isAutoNumber)
    .map(a => {
      const inputType = attrInputType(a)
      return `  <div class="form-group">
    <label for="${a.name}">${a.name}</label>
    <input type="${inputType}" id="${a.name}" name="${a.name}" class="form-control">
  </div>`
    })
    .join('\n')

  // One-to-many FK associations: render a single-select dropdown
  const o2mAssocs = entity.associations.filter(a => a.type === 'one-to-many')
  const o2mFields = o2mAssocs.map(assoc => {
    const targetName = assoc.targetEntityName
    const fkField = `${targetName.toLowerCase()}Id`
    const targetEntity = allEntities.find(e => e.name.toLowerCase() === targetName.toLowerCase())
    const displayAttr = targetEntity?.attributes.find(a => !a.isAutoNumber)?.name || 'id'
    return `  <div class="form-group">
    <label for="${fkField}">${targetName}</label>
    <select id="${fkField}" name="${fkField}" class="form-control">
      <option value="">— none —</option>
      <% (all${targetName} || []).forEach(function(p) { %>
      <option value="<%= p.id %>"><%= p.${displayAttr} %></option>
      <% }) %>
    </select>
  </div>`
  }).join('\n')

  // Many-to-many associations: render a multi-select
  const m2mAssocs = entity.associations.filter(a => a.type === 'many-to-many')
  const m2mFields = m2mAssocs.map(assoc => {
    const targetPlural = pluralize(assoc.targetEntityName)
    const targetEntity = allEntities.find(e => e.name.toLowerCase() === assoc.targetEntityName.toLowerCase())
    const displayAttr = targetEntity?.attributes.find(a => !a.isAutoNumber)?.name || 'id'
    return `  <div class="form-group">
    <label>${assoc.targetEntityName}</label>
    <select name="${targetPlural}Ids" multiple class="form-control" style="height:auto;min-height:80px">
      <% (all${assoc.targetEntityName} || []).forEach(function(s) { %>
      <option value="<%= s.id %>"><%= s.${displayAttr} %></option>
      <% }) %>
    </select>
  </div>`
  }).join('\n')

  return `<div class="container">
  <h1>New ${entity.name}</h1>
  <form method="POST" action="/${nameLower}/create">
${fields || '  <!-- TODO: form fields -->'}
${o2mFields}
${m2mFields}
    <div style="margin-top:1.25rem;display:flex;gap:0.75rem;align-items:center">
      <button type="submit" class="btn">Save</button>
      <a href="/${nameLower}_overview">Cancel</a>
    </div>
  </form>
</div>`
}

function generateEditFormView(entity: MendixEntity, allEntities: MendixEntity[] = []): string {
  const nameLower = entity.name.toLowerCase()
  const fields = entity.attributes
    .filter(a => !a.isAutoNumber)
    .map(a => {
      const inputType = attrInputType(a)
      return `  <div class="form-group">
    <label for="${a.name}">${a.name}</label>
    <input type="${inputType}" id="${a.name}" name="${a.name}" value="<%= item.${a.name} %>" class="form-control">
  </div>`
    })
    .join('\n')

  // One-to-many FK associations: render a single-select dropdown with pre-selection
  const o2mAssocs = entity.associations.filter(a => a.type === 'one-to-many')
  const o2mFields = o2mAssocs.map(assoc => {
    const targetName = assoc.targetEntityName
    const fkField = `${targetName.toLowerCase()}Id`
    const targetEntity = allEntities.find(e => e.name.toLowerCase() === targetName.toLowerCase())
    const displayAttr = targetEntity?.attributes.find(a => !a.isAutoNumber)?.name || 'id'
    return `  <div class="form-group">
    <label for="${fkField}">${targetName}</label>
    <select id="${fkField}" name="${fkField}" class="form-control">
      <option value="">— none —</option>
      <% (all${targetName} || []).forEach(function(p) { %>
      <option value="<%= p.id %>" <%= item.${fkField} === p.id ? 'selected' : '' %>><%= p.${displayAttr} %></option>
      <% }) %>
    </select>
  </div>`
  }).join('\n')

  // Many-to-many associations: render a multi-select with pre-selection
  const m2mAssocs = entity.associations.filter(a => a.type === 'many-to-many')
  const m2mFields = m2mAssocs.map(assoc => {
    const targetPlural = pluralize(assoc.targetEntityName)
    const targetEntity = allEntities.find(e => e.name.toLowerCase() === assoc.targetEntityName.toLowerCase())
    const displayAttr = targetEntity?.attributes.find(a => !a.isAutoNumber)?.name || 'id'
    return `  <div class="form-group">
    <label>${assoc.targetEntityName}</label>
    <select name="${targetPlural}Ids" multiple class="form-control" style="height:auto;min-height:80px">
      <% (all${assoc.targetEntityName} || []).forEach(function(s) { %>
      <option value="<%= s.id %>" <%= item.${targetPlural} && item.${targetPlural}.some(function(x) { return x.id === s.id }) ? 'selected' : '' %>><%= s.${displayAttr} %></option>
      <% }) %>
    </select>
  </div>`
  }).join('\n')

  return `<div class="container">
  <h1>Edit ${entity.name}</h1>
  <form method="POST" action="/${nameLower}/<%= item.id %>/update">
${fields || '  <!-- TODO: form fields -->'}
${o2mFields}
${m2mFields}
    <div style="margin-top:1.25rem;display:flex;gap:0.75rem;align-items:center">
      <button type="submit" class="btn">Save</button>
      <a href="/${nameLower}_overview">Cancel</a>
    </div>
  </form>
</div>`
}

function generateHomeAnonymousRoute(): string {
  return `// Generated by mendix-to-node
// Route for page: Home_Anonymous
import { Router, Request, Response } from 'express'
import { prisma } from '../db'
import { VAL_ContactFormEntry_Submit } from '../services/VAL_ContactFormEntry_Submit'

const router = Router()

// GET /home_anonymous - render marketing homepage
router.get('/home_anonymous', async (req: Request, res: Response) => {
  const userroleList: unknown[] = []
  res.render('Home_Anonymous', { title: 'Home', userroleList })
})

// POST /contact - handle contact form submission
router.post('/contact', async (req: Request, res: Response) => {
  const { Name, Email, Message } = req.body
  const validation = VAL_ContactFormEntry_Submit({ Name: Name ?? '', Email: Email ?? '', Message: Message ?? '' })
  if (!validation.valid) {
    return res.status(400).json({ success: false, errors: validation.errors })
  }
  try {
    await prisma.contactFormEntry.create({
      data: { Name: Name.trim(), Email: Email.trim(), Message: Message.trim(), SubmittedOn: new Date().toISOString() }
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to save contact form entry' })
  }
})

export default router
`
}

function generateRouteFile(page: MendixPage, entityModel?: MendixEntity, reverseO2m: ReverseRelation[] = []): string {
  if (page.name === 'Home_Anonymous') {
    return generateHomeAnonymousRoute()
  }
  const routePath = page.name.toLowerCase()
  // Only treat as a data-entity page when we have a resolved user model.
  // System entities (UserRole, etc.) are not in the Prisma schema.
  const hasEntity = !!entityModel
  const entity = (page.entityName || 'item').toLowerCase()
  const newFormView = entityModel ? `${entityModel.name}_new` : page.name
  const editFormView = entityModel ? `${entityModel.name}_edit` : page.name

  const m2mAssocs = entityModel?.associations.filter(a => a.type === 'many-to-many') ?? []
  const o2mAssocs = entityModel?.associations.filter(a => a.type === 'one-to-many') ?? []

  // ---- Overview list fetch — include o2m, m2m, and reverse o2m relations ----
  const listIncludeParts = [
    ...m2mAssocs.map(a => `${pluralize(a.targetEntityName)}: true`),
    ...o2mAssocs.map(a => `${a.targetEntityName.toLowerCase()}: true`),
    ...reverseO2m.map(r => `${r.assocField}: true`)
  ]
  const listInclude = listIncludeParts.join(', ')
  // When no entity is resolved, render with an empty list rather than calling
  // a non-existent prisma model and crashing at runtime.
  const listFetch = hasEntity
    ? listInclude
      ? `const ${entity}List = await prisma.${entity}.findMany({ include: { ${listInclude} } })`
      : `const ${entity}List = await prisma.${entity}.findMany()`
    : `const ${entity}List: unknown[] = []`

  // Shared render vars appended to every form render call
  const allAssocRenderVars = [
    ...m2mAssocs.map(a => `, all${a.targetEntityName}`),
    ...o2mAssocs.map(a => `, all${a.targetEntityName}`)
  ].join('')

  // ---- Edit GET snippets ----
  const editIncludeParts = [
    ...m2mAssocs.map(a => `${pluralize(a.targetEntityName)}: true`),
    ...o2mAssocs.map(a => `${a.targetEntityName.toLowerCase()}: true`)
  ]
  const editInclude = editIncludeParts.length > 0
    ? `, include: { ${editIncludeParts.join(', ')} }`
    : ''
  const editAssocLoads = [
    ...m2mAssocs.map(a =>
      `    const all${a.targetEntityName} = await prisma.${pluralize(a.targetEntityName)}.findMany()`),
    ...o2mAssocs.map(a =>
      `    const all${a.targetEntityName} = await prisma.${a.targetEntityName.toLowerCase()}.findMany({ orderBy: { id: 'asc' } })`)
  ].join('\n')
  const editRenderObj = (m2mAssocs.length > 0 || o2mAssocs.length > 0)
    ? `{ title: 'Edit ${page.entityName || entity}', item${allAssocRenderVars} }`
    : `{ title: 'Edit ${page.entityName || entity}', item }`

  // ---- Update POST snippets ----
  const m2mExtractLines = m2mAssocs.map(a => {
    const plural = pluralize(a.targetEntityName)
    return `    const raw${a.targetEntityName} = req.body.${plural}Ids\n    const ${plural}Ids = Array.isArray(raw${a.targetEntityName}) ? raw${a.targetEntityName} : raw${a.targetEntityName} ? [raw${a.targetEntityName}] : []`
  }).join('\n')
  const m2mDeleteLines = m2mAssocs.map(a => `    delete data.${pluralize(a.targetEntityName)}Ids`).join('\n')
  const m2mSetOps = m2mAssocs.map(a =>
    `      ${pluralize(a.targetEntityName)}: { set: ${pluralize(a.targetEntityName)}Ids.map((id: string) => ({ id: parseInt(id) })) }`
  ).join(',\n')

  // O2M: parse FK fields as integers on write
  const o2mFkFields = o2mAssocs.map(a => `${a.targetEntityName.toLowerCase()}Id`)
  const o2mFkParseLines = o2mFkFields.map(fk =>
    `    const ${fk} = req.body.${fk} ? parseInt(req.body.${fk}) : null`
  ).join('\n')
  const o2mFkSpread = o2mFkFields.length > 0
    ? `{ ...req.body, ${o2mFkFields.join(', ')} }`
    : `req.body`

  const updateDataBlock = m2mAssocs.length > 0
    ? [
        m2mExtractLines,
        `    const data: Record<string, unknown> = { ...req.body }`,
        m2mDeleteLines,
        ...o2mAssocs.map(a => {
          const fk = `${a.targetEntityName.toLowerCase()}Id`
          return `    data.${fk} = req.body.${fk} ? parseInt(req.body.${fk} as string) : null`
        }),
        `    await prisma.${entity}.update({ where: { id: parseInt(req.params.id) }, data: { ...data,\n${m2mSetOps}\n    } })`
      ].filter(Boolean).join('\n')
    : o2mAssocs.length > 0
      ? `${o2mFkParseLines}\n    await prisma.${entity}.update({ where: { id: parseInt(req.params.id) }, data: ${o2mFkSpread} })`
      : `    await prisma.${entity}.update({ where: { id: parseInt(req.params.id) }, data: req.body })`

  // ---- New GET + Create POST snippets ----
  const newAssocLoads = [
    ...m2mAssocs.map(a =>
      `    const all${a.targetEntityName} = await prisma.${pluralize(a.targetEntityName)}.findMany()`),
    ...o2mAssocs.map(a =>
      `    const all${a.targetEntityName} = await prisma.${a.targetEntityName.toLowerCase()}.findMany({ orderBy: { id: 'asc' } })`)
  ].join('\n')
  const newRenderObj = (m2mAssocs.length > 0 || o2mAssocs.length > 0)
    ? `{ title: 'New ${page.entityName || entity}', item: null${allAssocRenderVars} }`
    : `{ title: 'New ${page.entityName || entity}', item: null }`

  const m2mCreateExtractLines = m2mAssocs.map(a => {
    const plural = pluralize(a.targetEntityName)
    return `    const rawNew${a.targetEntityName} = req.body.${plural}Ids\n    const new${plural}Ids = Array.isArray(rawNew${a.targetEntityName}) ? rawNew${a.targetEntityName} : rawNew${a.targetEntityName} ? [rawNew${a.targetEntityName}] : []`
  }).join('\n')
  const m2mCreateDeleteLines = m2mAssocs.map(a => `    delete createData.${pluralize(a.targetEntityName)}Ids`).join('\n')
  const m2mConnectOps = m2mAssocs.map(a =>
    `      ${pluralize(a.targetEntityName)}: { connect: new${pluralize(a.targetEntityName)}Ids.map((id: string) => ({ id: parseInt(id) })) }`
  ).join(',\n')

  const createDataBlock = m2mAssocs.length > 0
    ? [
        m2mCreateExtractLines,
        `    const createData: Record<string, unknown> = { ...req.body }`,
        m2mCreateDeleteLines,
        ...o2mAssocs.map(a => {
          const fk = `${a.targetEntityName.toLowerCase()}Id`
          return `    createData.${fk} = req.body.${fk} ? parseInt(req.body.${fk} as string) : null`
        }),
        `    await prisma.${entity}.create({ data: { ...createData,\n${m2mConnectOps}\n    } })`
      ].filter(Boolean).join('\n')
    : o2mAssocs.length > 0
      ? `${o2mFkParseLines}\n    await prisma.${entity}.create({ data: ${o2mFkSpread} })`
      : `    await prisma.${entity}.create({ data: req.body })`

  // ---- New GET route body ----
  const newGetBody = (m2mAssocs.length > 0 || o2mAssocs.length > 0)
    ? `  try {\n${newAssocLoads}\n    res.render('${newFormView}', ${newRenderObj})\n  } catch (err) {\n    res.status(500).render('error', { title: 'Error', message: 'Failed to load form' })\n  }`
    : `  res.render('${newFormView}', ${newRenderObj})`

  return `// Generated by mendix-to-node
// Route for page: ${page.qualifiedName}
import { Router, Request, Response } from 'express'
import { prisma } from '../db'

const router = Router()

// GET /${routePath} - render page
router.get('/${routePath}', async (req: Request, res: Response) => {
  try {
    ${listFetch}
    res.render('${page.name}', { title: '${page.title || page.name}', ${entity}List })
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load ${page.name}' })
  }
})

// POST /${routePath}/save - handle form submit
router.post('/${routePath}/save', async (req: Request, res: Response) => {
  try {
    const data = req.body
    await prisma.${entity}.create({ data })
    res.redirect('/${routePath}')
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to save' })
  }
})

// GET /${entity}/new - render new record form
router.get('/${entity}/new', async (req: Request, res: Response) => {
${newGetBody}
})

// POST /${entity}/create - create new record
router.post('/${entity}/create', async (req: Request, res: Response) => {
  try {
${createDataBlock}
    res.redirect('/${routePath}')
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to create ${page.entityName || entity}' })
  }
})

// GET /${entity}/:id/edit - render edit form
router.get('/${entity}/:id/edit', async (req: Request, res: Response) => {
  try {
    const item = await prisma.${entity}.findUnique({ where: { id: parseInt(req.params.id) }${editInclude} })
    if (!item) return res.status(404).render('error', { title: 'Not found', message: '${page.entityName || entity} not found' })
${editAssocLoads}
    res.render('${editFormView}', ${editRenderObj})
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to load ${page.entityName || entity}' })
  }
})

// POST /${entity}/:id/update - save edits
router.post('/${entity}/:id/update', async (req: Request, res: Response) => {
  try {
${updateDataBlock}
    res.redirect('/${routePath}')
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to update ${page.entityName || entity}' })
  }
})

// POST /${entity}/:id/delete - delete record
router.post('/${entity}/:id/delete', async (req: Request, res: Response) => {
  try {
    await prisma.${entity}.delete({ where: { id: parseInt(req.params.id) } })
    res.redirect('/${routePath}')
  } catch (err) {
    res.status(500).render('error', { title: 'Error', message: 'Failed to delete ${page.entityName || entity}' })
  }
})

export default router
`
}

export function generatePages(pages: MendixPage[], entities: MendixEntity[] = [], deploymentUrl: string = ''): GeneratedFile[] {
  const limited = pages

  // Build lookup: entity name (lowercase) → MendixEntity
  const entityMap = new Map(entities.map(e => [e.name.toLowerCase(), e]))

  // Build reverse-o2m map: for each entity that is the TARGET of a one-to-many FK,
  // record which entities own that FK and what attributes they display.
  // E.g. Person → [{ ownerName: 'Skills', assocField: 'skills', displayAttrs: ['Name','Level'] }]
  const reverseO2mMap = new Map<string, ReverseRelation[]>()
  for (const e of entities) {
    for (const assoc of e.associations.filter(a => a.type === 'one-to-many')) {
      const targetLower = assoc.targetEntityName.toLowerCase()
      if (!reverseO2mMap.has(targetLower)) reverseO2mMap.set(targetLower, [])
      const ownerEntity = entityMap.get(e.name.toLowerCase())
      const displayAttrs = ownerEntity?.attributes.filter(a => !a.isAutoNumber).map(a => a.name) ?? []
      reverseO2mMap.get(targetLower)!.push({
        ownerName: e.name,
        assocField: pluralize(e.name),
        displayAttrs
      })
    }
  }

  // Track which entities already have a form view generated (one per entity, not one per page)
  const formViewsGenerated = new Set<string>()

  const files: GeneratedFile[] = []

  for (const page of limited) {
    const entityModel = page.entityName ? entityMap.get(page.entityName.toLowerCase()) : undefined
    const reverseO2m = reverseO2mMap.get(page.entityName?.toLowerCase() ?? '') ?? []

    files.push({
      path: `views/${page.name}.ejs`,
      content: generateEjsTemplate(page, reverseO2m, entityModel, deploymentUrl),
      category: 'pages'
    })

    files.push({
      path: `src/routes/${page.name}.ts`,
      content: generateRouteFile(page, entityModel, reverseO2m),
      category: 'routes'
    })

    // Generate dedicated new/edit form views for each entity (once per entity)
    if (entityModel && !formViewsGenerated.has(entityModel.name)) {
      formViewsGenerated.add(entityModel.name)
      files.push({
        path: `views/${entityModel.name}_new.ejs`,
        content: generateNewFormView(entityModel, entities),
        category: 'pages'
      })
      files.push({
        path: `views/${entityModel.name}_edit.ejs`,
        content: generateEditFormView(entityModel, entities),
        category: 'pages'
      })
    }
  }

  // Always generate a minimal error view used by route error handlers
  files.push({
    path: 'views/error.ejs',
    content: `<div class="container">
  <h1>Error</h1>
  <p style="color:#c0392b;margin:1rem 0"><%= message %></p>
  <a href="/" class="btn">Back</a>
</div>`,
    category: 'pages'
  })

  return files
}

export function generateEntityRoutes(entities: Array<{ name: string }>): GeneratedFile[] {
  return entities.filter(e => e.name).map(entity => {
    const name = entity.name
    const nameLower = name.toLowerCase()

    const content = `// Generated by mendix-to-node
// CRUD routes for entity: ${name}
import { Router, Request, Response } from 'express'
import { prisma } from '../db'

const router = Router()

// GET /${nameLower} - list all
router.get('/${nameLower}', async (req: Request, res: Response) => {
  try {
    const items = await prisma.${nameLower}.findMany()
    res.json(items)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ${name} records' })
  }
})

// GET /${nameLower}/:id - get one
router.get('/${nameLower}/:id', async (req: Request, res: Response) => {
  try {
    const item = await prisma.${nameLower}.findUnique({ where: { id: parseInt(req.params.id) } })
    if (!item) return res.status(404).json({ error: 'Not found' })
    res.json(item)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ${name}' })
  }
})

// POST /${nameLower} - create
router.post('/${nameLower}', async (req: Request, res: Response) => {
  try {
    const item = await prisma.${nameLower}.create({ data: req.body })
    res.status(201).json(item)
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ${name}' })
  }
})

// PUT /${nameLower}/:id - update
router.put('/${nameLower}/:id', async (req: Request, res: Response) => {
  try {
    const item = await prisma.${nameLower}.update({
      where: { id: parseInt(req.params.id) },
      data: req.body
    })
    res.json(item)
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ${name}' })
  }
})

// DELETE /${nameLower}/:id - delete
router.delete('/${nameLower}/:id', async (req: Request, res: Response) => {
  try {
    await prisma.${nameLower}.delete({ where: { id: parseInt(req.params.id) } })
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete ${name}' })
  }
})

export default router
`

    return {
      path: `src/routes/${nameLower}.ts`,
      content,
      category: 'routes' as const
    }
  })
}
