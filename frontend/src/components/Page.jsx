import PageHeader from './PageHeader.jsx'

// The page shell.
//
// There were three, plus five bespoke layouts, and no agreement on whether a
// page even had a title: two pages opened with <h1>, five with <h2>, and six
// named themselves with a <div className="side-title"> in a sidebar — a div, so
// those pages had no heading at all and nothing to land on.
//
// One component now, with a variant for each of the three *height models* the
// app genuinely has. The variant is a layout fact, not a page's taste:
//
//   doc    the element itself scrolls; 960px, centred. Projects, Tools, Review.
//   split  full-height flex; an <aside> and a <main> own their own scrolling.
//          The six file-editor pages.
//   fill   full-height flex; the page's own children own the scrolling. Network.
//
// `doc` keeps its heading inside the centred column, where it has always been.
// `split` and `fill` fill the viewport, so their heading becomes a bar across
// the top — which is the shape the Workspace's own header already had, and it
// is now the same rule (see `.page-shell > .page-head, .ws-head` in styles.css).
//
// The title is an <h1> in every variant. One <h1> per page, sections at <h2>,
// cards at <h3>; before this, <h2> was a page title on five pages, a section
// title on three, and the chat greeting.
const VARIANTS = {
  doc: 'page',
  split: 'page-shell',
  fill: 'page-shell',
}

export default function Page({
  variant = 'doc', title, lede, actions, className = '', children, ...rest
}) {
  const cls = [VARIANTS[variant] ?? VARIANTS.doc, className].filter(Boolean).join(' ')
  const body = variant === 'split'
    ? <div className="split-layout">{children}</div>
    : children
  return (
    <div className={cls} {...rest}>
      {title && <PageHeader level={1} title={title} lede={lede} actions={actions} />}
      {body}
    </div>
  )
}
