import { useState, useEffect } from 'react';

export function Header() {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <header className={`header ${scrolled ? 'scrolled' : ''}`}>
            <div className="container header-inner">
                <a href="/" className="logo">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                    </svg>
                    <span>KISAME</span>
                </a>

                <nav className="nav-links">
                    <a href="#features" className="nav-link">Features</a>
                    <a href="#docs" className="nav-link">Docs</a>
                    <a href="#pricing" className="nav-link">Pricing</a>
                </nav>

                <div className="header-actions">
                    <a href="#" className="btn btn-ghost">Sign in</a>
                    <a href="#download" className="btn btn-primary">Download</a>
                </div>
            </div>
        </header>
    );
}
