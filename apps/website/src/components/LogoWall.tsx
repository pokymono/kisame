export function LogoWall() {
    const companies = ['CrowdStrike', 'Palo Alto', 'Splunk', 'Mandiant', 'Fortinet', 'Cisco'];

    return (
        <section className="logo-wall">
            <div className="container">
                <p className="logo-wall-title">Trusted by security teams worldwide</p>
                <div className="logo-row">
                    {companies.map((name) => (
                        <span key={name} className="logo-item">{name}</span>
                    ))}
                </div>
            </div>
        </section>
    );
}
