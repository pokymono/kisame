import { useMemo } from 'react';

const DOWNLOAD_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7,10 12,15 17,10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

type Platform = 'macos' | 'windows' | 'mobile' | 'unknown';

type DownloadButtonsProps = {
    className?: string;
    id?: string;
    showIcon?: boolean;
};

type NavigatorWithUAData = Navigator & {
    userAgentData?: {
        platform?: string;
        mobile?: boolean;
    };
};

const getPlatform = (): Platform => {
    if (typeof navigator === 'undefined') return 'unknown';

    const ua = navigator.userAgent || '';
    const uaData = (navigator as NavigatorWithUAData).userAgentData;
    const platform = (uaData?.platform || navigator.platform || '').toLowerCase();
    const maxTouchPoints = navigator.maxTouchPoints || 0;

    const isIpadAsMac = /macintosh/i.test(ua) && maxTouchPoints > 1;
    const isMobile = Boolean(uaData?.mobile) || /android|iphone|ipad|ipod|mobile/i.test(ua) || isIpadAsMac;
    if (isMobile) return 'mobile';

    if (platform.includes('mac') || /mac os x/i.test(ua)) return 'macos';
    if (platform.includes('win') || /windows/i.test(ua)) return 'windows';

    return 'unknown';
};

export function DownloadButtons({ className, id, showIcon = true }: DownloadButtonsProps) {
    const platform = useMemo(() => getPlatform(), []);
    const showBoth = platform === 'unknown' || platform === 'mobile';

    const buttons = showBoth
        ? [
              { label: 'Download for macOS', primary: true, key: 'macos' },
              { label: 'Download for Windows', primary: false, key: 'windows' },
          ]
        : [
              {
                  label: platform === 'windows' ? 'Download for Windows' : 'Download for macOS',
                  primary: true,
                  key: platform,
              },
          ];

    return (
        <div id={id} className={['download-actions', className].filter(Boolean).join(' ')}>
            {buttons.map(({ label, primary, key }) => (
                <a key={key} href="#download" className={primary ? 'btn btn-primary' : 'btn'}>
                    {label}
                    {showIcon ? DOWNLOAD_ICON : null}
                </a>
            ))}
        </div>
    );
}
