import type { Metadata } from 'next';
import './dashboard.css';

export const metadata: Metadata = {
  title: 'CSDO Growth Dashboard | Daily Report',
  description: 'Visualise CSDO point growth over time with interactive charts and leaderboards.',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
