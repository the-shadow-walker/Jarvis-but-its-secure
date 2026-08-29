import { ReviewQueue } from '../pages/Review.jsx'

// The unified Review Center, scoped to this one project: the same commit
// requests, egress host approvals and security alerts (incl. advisory write
// flags) the global /review page shows, filtered to this slug.
export default function ReviewPanel({ slug }) {
  return (
    <div className="pane-col">
      <div className="review-scrollwrap"><ReviewQueue slug={slug} /></div>
    </div>
  )
}
