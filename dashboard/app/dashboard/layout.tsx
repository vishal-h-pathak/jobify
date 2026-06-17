import "../_internal.css";
import { ToastProvider } from "./components/Toast";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="internal-surface">
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
