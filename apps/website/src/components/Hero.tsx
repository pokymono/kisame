import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DownloadButtons } from './DownloadButtons';

gsap.registerPlugin(ScrollTrigger);

export function Hero() {
    const imageRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const image = imageRef.current;
        const content = contentRef.current;

        if (!image || !content) return;

        gsap.set(image, {
            y: 100,
            opacity: 0.3,
            scale: 0.95,
        });

        gsap.to(image, {
            y: 0,
            opacity: 1,
            scale: 1,
            ease: 'power2.out',
            scrollTrigger: {
                trigger: content,
                start: 'top 80%',
                end: 'bottom 20%',
                scrub: 1,
            },
        });

        return () => {
            ScrollTrigger.getAll().forEach(trigger => trigger.kill());
        };
    }, []);

    return (
        <section id="download" className="hero" style={{ paddingBottom: '8rem' }}>
            <div
                ref={contentRef}
                className="container"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
                <h1 className="hero-title animate-slide-up">KISAME</h1>

                <p className="hero-subtitle animate-slide-up delay-1">
                    Network Forensics Engine
                </p>

                <p className="hero-description animate-slide-up delay-2">
                    Load a PCAP capture to begin deep packet inspection, session correlation,
                    and AI-powered forensic analysis.
                </p>

                <div className="hero-actions animate-slide-up delay-3">
                    <DownloadButtons className="download-actions--hero" />
                    <a href="#features" className="btn">Learn more</a>
                </div>

                <div
                    ref={imageRef}
                    className="app-preview"
                    style={{ marginTop: '4rem' }}
                >
                    <img src="/app.png" alt="Kisame Network Forensics Engine" />
                </div>
            </div>
        </section>
    );
}
