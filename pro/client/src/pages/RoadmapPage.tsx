import { Link } from "react-router-dom";
import { ArrowLeft, Compass, type LucideIcon } from "lucide-react";

interface RoadmapPageProps {
  title: string;
  eyebrow: string;
  milestone: string;
  summary: string;
  bullets: string[];
  icon?: LucideIcon;
}

export function RoadmapPage({
  title,
  eyebrow,
  milestone,
  summary,
  bullets,
  icon: Icon = Compass,
}: RoadmapPageProps) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <Link to="/projects" className="btn btn-ghost">
          <ArrowLeft size={15} /> Back to projects
        </Link>
      </header>

      <section className="roadmap-card">
        <span className="roadmap-icon" aria-hidden="true">
          <Icon size={24} />
        </span>
        <span className="roadmap-status mono">{milestone}</span>
        <h2>Reserved surface, not a fake one</h2>
        <p className="roadmap-summary">{summary}</p>
        <ul className="roadmap-list">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <p className="panel-note">
          This screen shows no simulated controls, counts or results. It stays
          empty until the operation behind it is real and verified. Source
          uploads, probing, the timeline and the FFmpeg export are live in the
          editor today.
        </p>
        <Link to="/projects" className="btn btn-primary">
          Open a working project
        </Link>
      </section>
    </div>
  );
}
