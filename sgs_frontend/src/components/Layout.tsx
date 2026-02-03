import { WalletSwitcher } from './WalletSwitcher';
import type { Page } from '../types/navigation';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  return (
    <div className="studio">
      <div className="studio-background" aria-hidden="true">
        <div className="studio-orb orb-1" />
        <div className="studio-orb orb-2" />
        <div className="studio-orb orb-3" />
        <div className="studio-grid" />
      </div>

      <header className="studio-header">
        <div className="brand">
          <div className="brand-title">Stellar Game Studio</div>
          <p className="brand-subtitle">A DEVELOPER TOOLKIT FOR BUILDING WEB3 GAMES ON STELLAR</p>
          <nav className="header-nav">
            <button
              type="button"
              className={`header-link ${currentPage === 'home' ? 'active' : ''}`}
              onClick={() => onNavigate('home')}
              aria-current={currentPage === 'home' ? 'page' : undefined}
            >
              Studio
            </button>
            <button
              type="button"
              className={`header-link ${currentPage === 'games' ? 'active' : ''}`}
              onClick={() => onNavigate('games')}
              aria-current={currentPage === 'games' ? 'page' : undefined}
            >
              Games Library
            </button>
            <button
              type="button"
              className={`header-link ${currentPage === 'docs' ? 'active' : ''}`}
              onClick={() => onNavigate('docs')}
              aria-current={currentPage === 'docs' ? 'page' : undefined}
            >
              Documentation
            </button>
          </nav>
        </div>
        <div className="header-actions">
          <div className="network-pill">Testnet</div>
          <WalletSwitcher />
          <a
            className="button primary small"
            href="https://github.com/jamesbachini/Stellar-Game-Studio"
            target="_blank"
            rel="noreferrer"
          >
            Fork on GitHub
          </a>
        </div>
      </header>

      <main className="studio-main">{children}</main>

      <footer className="studio-footer">
        <span>Built with ♥️ for Stellar game developers</span>
      </footer>
    </div>
  );
}
