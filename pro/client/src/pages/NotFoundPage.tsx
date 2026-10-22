import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export function NotFoundPage() {
  return (
    <div className="page">
      <div className="empty-state">
        <p className="eyebrow">404</p>
        <h2>This cut does not exist</h2>
        <p>The route is unknown. Head back to the project shelf.</p>
        <Link to="/" className="btn btn-primary">
          <ArrowLeft size={15} /> Back to the studio
        </Link>
      </div>
    </div>
  );
}
