export function Features() {
    return (
        <section className="section" id="features">
            <div className="container">
                <div style={{ textAlign: 'center', marginBottom: '5rem' }}>
                    <p className="section-label" style={{ marginBottom: '1rem' }}>
                        Built for forensics
                    </p>
                    <h2 style={{ maxWidth: '600px', margin: '0 auto' }}>
                        Analyze network captures with AI-powered insights
                    </h2>
                </div>

                <div style={{ marginBottom: '6rem' }}>
                    <div className="feature-section">
                        <div className="feature-content">
                            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
                                Deep Packet Inspection
                            </h3>
                            <p style={{ fontSize: '1rem', lineHeight: '1.8', marginBottom: '1.5rem' }}>
                                Load PCAP files and instantly reconstruct sessions across 50+ protocols.
                                See traffic patterns, anomalies, and threats at a glance.
                            </p>
                        </div>
                        <div className="feature-visual">
                            <ProtocolStack />
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '6rem' }}>
                    <div className="feature-section reversed">
                        <div className="feature-content">
                            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
                                Conversational Analysis
                            </h3>
                            <p style={{ fontSize: '1rem', lineHeight: '1.8', marginBottom: '1.5rem' }}>
                                Ask questions in plain English. Get evidence-anchored answers
                                with direct links to the packets that matter.
                            </p>
                        </div>
                        <div className="feature-visual">
                            <ChatPreview />
                        </div>
                    </div>
                </div>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '3rem',
                    textAlign: 'center',
                    padding: '3rem 0',
                    borderTop: '1px solid var(--app-line)',
                    borderBottom: '1px solid var(--app-line)'
                }}>
                    <div>
                        <p className="mono" style={{ fontSize: '2rem', fontWeight: '600', color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>
                            50+
                        </p>
                        <p style={{ fontSize: '0.875rem', color: 'var(--app-text-faint)' }}>
                            Protocols supported
                        </p>
                    </div>
                    <div>
                        <p className="mono" style={{ fontSize: '2rem', fontWeight: '600', color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>
                            &lt;1s
                        </p>
                        <p style={{ fontSize: '0.875rem', color: 'var(--app-text-faint)' }}>
                            Analysis time
                        </p>
                    </div>
                    <div>
                        <p className="mono" style={{ fontSize: '2rem', fontWeight: '600', color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>
                            100%
                        </p>
                        <p style={{ fontSize: '0.875rem', color: 'var(--app-text-faint)' }}>
                            Local processing
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}

function ProtocolStack() {
    const protocols = ['TCP', 'UDP', 'HTTP', 'DNS', 'TLS'];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
            {protocols.map((proto, i) => (
                <div
                    key={proto}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem 1rem',
                        background: 'var(--app-surface)',
                        borderRadius: '6px',
                        border: '1px solid var(--app-line)',
                        opacity: 1 - (i * 0.12)
                    }}
                >
                    <span className="mono" style={{
                        fontSize: '0.7rem',
                        letterSpacing: '0.1em',
                        color: 'var(--accent-primary)',
                        width: '40px'
                    }}>
                        {proto}
                    </span>
                    <div style={{
                        flex: 1,
                        height: '4px',
                        background: 'var(--app-line)',
                        borderRadius: '2px',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            width: `${80 - (i * 12)}%`,
                            height: '100%',
                            background: 'var(--accent-primary)',
                            opacity: 0.6
                        }} />
                    </div>
                    <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--app-text-faint)' }}>
                        {Math.floor(Math.random() * 500 + 100)}
                    </span>
                </div>
            ))}
        </div>
    );
}

function ChatPreview() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
            <div style={{
                padding: '0.875rem 1rem',
                background: 'var(--app-surface)',
                borderRadius: '8px',
                border: '1px solid var(--app-line)',
                fontSize: '0.875rem',
                color: 'var(--app-text-muted)'
            }}>
                Show me suspicious DNS queries in the last hour
            </div>
            <div style={{
                padding: '1rem',
                background: 'var(--app-bg-deep)',
                borderRadius: '8px',
                border: '1px solid var(--app-line)',
                fontSize: '0.875rem',
                color: 'var(--app-text-muted)',
                lineHeight: '1.6'
            }}>
                Found <span style={{ color: 'var(--accent-primary)' }}>3 suspicious queries</span> to
                known C2 domains. The first occurred at 10:23:47 from host 192.168.1.45...
            </div>
        </div>
    );
}
