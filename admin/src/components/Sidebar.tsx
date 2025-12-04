import { VscTerminal, VscPerson, VscGitPullRequest, VscFolder } from 'react-icons/vsc';

type View = 'console' | 'users' | 'requests' | 'vaults';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  serverRunning: boolean;
}

const navItems: { id: View; label: string; icon: React.ReactNode; requiresServer: boolean }[] = [
  { id: 'console', label: 'Console', icon: <VscTerminal />, requiresServer: false },
  { id: 'users', label: 'Users', icon: <VscPerson />, requiresServer: true },
  { id: 'requests', label: 'Requests', icon: <VscGitPullRequest />, requiresServer: true },
  { id: 'vaults', label: 'Vaults', icon: <VscFolder />, requiresServer: true }
];

export default function Sidebar({ currentView, onViewChange, serverRunning }: SidebarProps) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isDisabled = item.requiresServer && !serverRunning;
          return (
            <button
              key={item.id}
              className={`nav-item ${currentView === item.id ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={() => !isDisabled && onViewChange(item.id)}
              disabled={isDisabled}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
