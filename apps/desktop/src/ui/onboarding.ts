import { el, svgEl } from './dom';

export type OnboardingStep = {
  id: string;
  title: string;
  subtitle: string;
  content: HTMLElement;
  /** Optional validation function - return true to allow proceeding */
  validate?: () => boolean | Promise<boolean>;
};

export interface OnboardingRefs {
  overlay: HTMLElement;
  modal: HTMLElement;
  stepIndicators: HTMLElement;
  contentArea: HTMLElement;
  titleEl: HTMLElement;
  subtitleEl: HTMLElement;
  prevButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  skipButton: HTMLButtonElement;
}

export interface OnboardingOptions {
  steps: OnboardingStep[];
  onComplete?: () => void;
  onSkip?: () => void;
  allowSkip?: boolean;
}

export class OnboardingManager {
  private refs: OnboardingRefs;
  private steps: OnboardingStep[];
  private currentStep = 0;
  private onComplete?: () => void;
  private onSkip?: () => void;
  private allowSkip: boolean;
  private isAnimating = false;

  constructor(options: OnboardingOptions) {
    this.steps = options.steps;
    this.onComplete = options.onComplete;
    this.onSkip = options.onSkip;
    this.allowSkip = options.allowSkip ?? true;
    this.refs = this.createUI();
    this.render();
  }

  private createUI(): OnboardingRefs {
    const overlay = el('div', {
      className: 'onboarding-overlay',
      attrs: {
        style: `
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(44, 47, 51, 0.65);
          backdrop-filter: blur(6px);
          opacity: 0;
          transition: opacity 0.35s ease-out;
        `
      }
    });

    // Modal container
    const modal = el('div', {
      className: 'onboarding-modal',
      attrs: {
        style: `
          position: relative;
          width: 520px;
          max-width: 90vw;
          max-height: 85vh;
          background: var(--app-surface);
          border: 1px solid var(--app-line-strong);
          border-radius: 12px;
          box-shadow: 
            0 0 0 1px rgba(255, 255, 255, 0.02) inset,
            0 24px 48px rgba(0, 0, 0, 0.3),
            0 0 1px rgba(0, 0, 0, 0.3);
          transform: translateY(16px) scale(0.98);
          opacity: 0;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden;
        `
      }
    });

    // Decorative top accent line
    const accentLine = el('div', {
      attrs: {
        style: `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent 0%, var(--accent-primary) 50%, transparent 100%);
          opacity: 0.5;
        `
      }
    });

    // Corner decorations
    const cornerTL = createCornerMark('top-left');
    const cornerTR = createCornerMark('top-right');
    const cornerBL = createCornerMark('bottom-left');
    const cornerBR = createCornerMark('bottom-right');

    // Background grid pattern
    const gridPattern = el('div', {
      attrs: {
        style: `
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle, var(--app-line) 1px, transparent 1px);
          background-size: 20px 20px;
          opacity: 0.3;
          pointer-events: none;
        `
      }
    });

    // Inner content wrapper
    const innerWrapper = el('div', {
      attrs: {
        style: `
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          padding: 40px 48px 32px;
        `
      }
    });

    // Step indicators container
    const stepIndicators = el('div', {
      className: 'onboarding-steps',
      attrs: {
        style: `
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-bottom: 32px;
        `
      }
    });

    // Header area
    const header = el('div', {
      attrs: {
        style: `
          text-align: center;
          margin-bottom: 28px;
        `
      }
    });

    const titleEl = el('h2', {
      className: 'onboarding-title',
      attrs: {
        style: `
          font-family: var(--font-display);
          font-size: 24px;
          font-weight: 600;
          color: var(--app-text);
          margin: 0 0 8px;
          letter-spacing: -0.02em;
        `
      }
    });

    const subtitleEl = el('p', {
      className: 'onboarding-subtitle',
      attrs: {
        style: `
          font-family: var(--font-ui);
          font-size: 14px;
          color: var(--app-text-muted);
          margin: 0;
          line-height: 1.5;
        `
      }
    });

    header.appendChild(titleEl);
    header.appendChild(subtitleEl);

    // Content area with scroll
    const contentArea = el('div', {
      className: 'onboarding-content',
      attrs: {
        style: `
          flex: 1;
          min-height: 200px;
          max-height: 360px;
          overflow-y: auto;
          overflow-x: hidden;
          margin-bottom: 28px;
          padding: 4px;
        `
      }
    });

    // Navigation buttons container
    const navContainer = el('div', {
      attrs: {
        style: `
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        `
      }
    });

    // Skip button
    const skipButton = el('button', {
      text: 'Skip setup',
      attrs: {
        type: 'button',
        style: `
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 450;
          color: var(--app-text-faint);
          background: transparent;
          border: none;
          padding: 8px 12px;
          cursor: pointer;
          transition: color 0.2s;
          border-radius: 6px;
        `
      }
    }) as HTMLButtonElement;

    skipButton.addEventListener('mouseenter', () => {
      skipButton.style.color = 'var(--app-text-muted)';
    });
    skipButton.addEventListener('mouseleave', () => {
      skipButton.style.color = 'var(--app-text-faint)';
    });

    // Button group for prev/next
    const buttonGroup = el('div', {
      attrs: {
        style: `
          display: flex;
          gap: 10px;
        `
      }
    });

    // Previous button
    const prevButton = el('button', {
      attrs: {
        type: 'button',
        style: `
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 500;
          color: var(--app-text-muted);
          background: var(--app-surface);
          border: 1px solid var(--app-line);
          border-radius: 8px;
          padding: 10px 18px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        `
      }
    }) as HTMLButtonElement;

    const prevIcon = createChevronIcon('left');
    prevButton.appendChild(prevIcon);
    prevButton.appendChild(document.createTextNode('Back'));

    prevButton.addEventListener('mouseenter', () => {
      prevButton.style.borderColor = 'var(--app-line-strong)';
      prevButton.style.background = 'var(--app-surface-elevated)';
    });
    prevButton.addEventListener('mouseleave', () => {
      prevButton.style.borderColor = 'var(--app-line)';
      prevButton.style.background = 'var(--app-surface)';
    });

    // Next button (primary action)
    const nextButton = el('button', {
      attrs: {
        type: 'button',
        style: `
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-ui);
          font-size: 13px;
          font-weight: 500;
          color: #1a1c1e;
          background: linear-gradient(180deg, var(--accent-primary-light) 0%, var(--accent-primary) 100%);
          border: 1px solid var(--accent-primary);
          border-radius: 8px;
          padding: 10px 20px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 8px rgba(110, 181, 181, 0.25);
        `
      }
    }) as HTMLButtonElement;

    nextButton.appendChild(document.createTextNode('Continue'));
    const nextIcon = createChevronIcon('right');
    nextButton.appendChild(nextIcon);

    nextButton.addEventListener('mouseenter', () => {
      nextButton.style.transform = 'translateY(-1px)';
      nextButton.style.boxShadow = '0 4px 16px rgba(110, 181, 181, 0.35)';
    });
    nextButton.addEventListener('mouseleave', () => {
      nextButton.style.transform = 'translateY(0)';
      nextButton.style.boxShadow = '0 2px 8px rgba(110, 181, 181, 0.25)';
    });

    buttonGroup.appendChild(prevButton);
    buttonGroup.appendChild(nextButton);

    navContainer.appendChild(skipButton);
    navContainer.appendChild(buttonGroup);

    innerWrapper.appendChild(stepIndicators);
    innerWrapper.appendChild(header);
    innerWrapper.appendChild(contentArea);
    innerWrapper.appendChild(navContainer);

    modal.appendChild(gridPattern);
    modal.appendChild(accentLine);
    modal.appendChild(cornerTL);
    modal.appendChild(cornerTR);
    modal.appendChild(cornerBL);
    modal.appendChild(cornerBR);
    modal.appendChild(innerWrapper);

    overlay.appendChild(modal);

    // Event bindings
    prevButton.addEventListener('click', () => this.prev());
    nextButton.addEventListener('click', () => this.next());
    skipButton.addEventListener('click', () => this.skip());

    // Keyboard navigation
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.allowSkip) {
        this.skip();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        this.next();
      } else if (e.key === 'ArrowLeft') {
        this.prev();
      }
    });

    return {
      overlay,
      modal,
      stepIndicators,
      contentArea,
      titleEl,
      subtitleEl,
      prevButton,
      nextButton,
      skipButton,
    };
  }

  private renderStepIndicators(): void {
    const { stepIndicators } = this.refs;
    stepIndicators.innerHTML = '';

    this.steps.forEach((step, index) => {
      const isActive = index === this.currentStep;
      const isCompleted = index < this.currentStep;

      const indicator = el('div', {
        attrs: {
          'data-step': String(index),
          style: `
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: ${isActive ? '32px' : '10px'};
            height: 10px;
            border-radius: 5px;
            background: ${isActive 
              ? 'var(--accent-primary)' 
              : isCompleted 
                ? 'var(--accent-primary-muted)' 
                : 'var(--app-line)'};
            border: 1px solid ${isActive 
              ? 'var(--accent-primary-light)' 
              : isCompleted 
                ? 'rgba(110, 181, 181, 0.3)' 
                : 'transparent'};
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: ${isCompleted ? 'pointer' : 'default'};
            ${isActive ? 'box-shadow: 0 0 12px rgba(110, 181, 181, 0.4);' : ''}
          `
        }
      });

      if (isCompleted) {
        // Add checkmark for completed steps
        const check = svgEl('svg', {
          attrs: { 
            viewBox: '0 0 12 12', 
            fill: 'none', 
            stroke: 'var(--accent-primary)',
            'stroke-width': '2',
            style: 'width: 8px; height: 8px;'
          },
          children: [
            svgEl('path', {
              attrs: {
                d: 'M2 6l3 3 5-6',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round'
              }
            })
          ]
        });
        indicator.appendChild(check);
        
        indicator.addEventListener('click', () => {
          if (!this.isAnimating) this.goToStep(index);
        });
        indicator.addEventListener('mouseenter', () => {
          indicator.style.transform = 'scale(1.2)';
        });
        indicator.addEventListener('mouseleave', () => {
          indicator.style.transform = 'scale(1)';
        });
      }

      // Connector line between indicators
      if (index < this.steps.length - 1) {
        const connector = el('div', {
          attrs: {
            style: `
              width: 24px;
              height: 1px;
              background: ${index < this.currentStep 
                ? 'var(--accent-primary-muted)' 
                : 'var(--app-line)'};
              margin: 0 4px;
              transition: background 0.3s;
            `
          }
        });
        stepIndicators.appendChild(indicator);
        stepIndicators.appendChild(connector);
      } else {
        stepIndicators.appendChild(indicator);
      }
    });
  }

  private render(): void {
    const step = this.steps[this.currentStep];
    if (!step) return;

    const { titleEl, subtitleEl, contentArea, prevButton, nextButton, skipButton } = this.refs;

    // Update header
    titleEl.textContent = step.title;
    subtitleEl.textContent = step.subtitle;

    // Update content with animation
    contentArea.innerHTML = '';
    const contentWrapper = el('div', {
      attrs: {
        style: `
          opacity: 0;
          transform: translateX(10px);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `
      },
      children: [step.content]
    });
    contentArea.appendChild(contentWrapper);
    
    // Trigger animation
    requestAnimationFrame(() => {
      contentWrapper.style.opacity = '1';
      contentWrapper.style.transform = 'translateX(0)';
    });

    // Update navigation state
    prevButton.style.display = this.currentStep === 0 ? 'none' : 'flex';
    
    const isLastStep = this.currentStep === this.steps.length - 1;
    nextButton.innerHTML = '';
    if (isLastStep) {
      nextButton.appendChild(document.createTextNode('Get Started'));
      const checkIcon = createCheckIcon();
      nextButton.appendChild(checkIcon);
    } else {
      nextButton.appendChild(document.createTextNode('Continue'));
      const chevron = createChevronIcon('right');
      nextButton.appendChild(chevron);
    }

    // Skip visibility
    skipButton.style.display = this.allowSkip ? 'block' : 'none';

    // Render step indicators
    this.renderStepIndicators();
  }

  private async next(): Promise<void> {
    if (this.isAnimating) return;

    const step = this.steps[this.currentStep];
    if (step.validate) {
      const isValid = await step.validate();
      if (!isValid) return;
    }

    if (this.currentStep < this.steps.length - 1) {
      this.isAnimating = true;
      await this.animateTransition('next');
      this.currentStep++;
      this.render();
      this.isAnimating = false;
    } else {
      this.complete();
    }
  }

  private async prev(): Promise<void> {
    if (this.isAnimating || this.currentStep === 0) return;

    this.isAnimating = true;
    await this.animateTransition('prev');
    this.currentStep--;
    this.render();
    this.isAnimating = false;
  }

  private async goToStep(index: number): Promise<void> {
    if (this.isAnimating || index === this.currentStep) return;
    if (index < 0 || index >= this.steps.length) return;

    this.isAnimating = true;
    const direction = index > this.currentStep ? 'next' : 'prev';
    await this.animateTransition(direction);
    this.currentStep = index;
    this.render();
    this.isAnimating = false;
  }

  private animateTransition(direction: 'next' | 'prev'): Promise<void> {
    return new Promise((resolve) => {
      const { contentArea } = this.refs;
      const translateX = direction === 'next' ? '-20px' : '20px';
      
      contentArea.style.transition = 'all 0.2s ease-out';
      contentArea.style.opacity = '0';
      contentArea.style.transform = `translateX(${translateX})`;

      setTimeout(() => {
        contentArea.style.transform = 'translateX(0)';
        contentArea.style.opacity = '1';
        resolve();
      }, 200);
    });
  }

  private skip(): void {
    this.close();
    this.onSkip?.();
  }

  private complete(): void {
    this.close();
    this.onComplete?.();
  }

  private close(): void {
    const { overlay, modal } = this.refs;
    
    modal.style.transform = 'translateY(-10px) scale(0.96)';
    modal.style.opacity = '0';
    overlay.style.opacity = '0';

    setTimeout(() => {
      overlay.remove();
    }, 400);
  }

  show(): void {
    document.body.appendChild(this.refs.overlay);
    
    // Trigger enter animation
    requestAnimationFrame(() => {
      this.refs.overlay.style.opacity = '1';
      this.refs.modal.style.transform = 'translateY(0) scale(1)';
      this.refs.modal.style.opacity = '1';
    });

    // Focus the modal for keyboard navigation
    this.refs.modal.setAttribute('tabindex', '-1');
    this.refs.modal.focus();
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  getSteps(): OnboardingStep[] {
    return this.steps;
  }
}

// Helper functions for icons
function createChevronIcon(direction: 'left' | 'right'): SVGSVGElement {
  const d = direction === 'left' 
    ? 'M14 6l-6 6 6 6' 
    : 'M10 6l6 6-6 6';
  
  return svgEl('svg', {
    attrs: { 
      viewBox: '0 0 24 24', 
      fill: 'none', 
      stroke: 'currentColor',
      'stroke-width': '2',
      style: 'width: 16px; height: 16px;'
    },
    children: [
      svgEl('path', {
        attrs: {
          d,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        }
      })
    ]
  }) as SVGSVGElement;
}

function createCheckIcon(): SVGSVGElement {
  return svgEl('svg', {
    attrs: { 
      viewBox: '0 0 24 24', 
      fill: 'none', 
      stroke: 'currentColor',
      'stroke-width': '2',
      style: 'width: 16px; height: 16px;'
    },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M5 12l5 5L20 7',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        }
      })
    ]
  }) as SVGSVGElement;
}

function createCornerMark(position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): HTMLElement {
  const positions = {
    'top-left': { top: '12px', left: '12px', borderRight: 'none', borderBottom: 'none' },
    'top-right': { top: '12px', right: '12px', borderLeft: 'none', borderBottom: 'none' },
    'bottom-left': { bottom: '12px', left: '12px', borderRight: 'none', borderTop: 'none' },
    'bottom-right': { bottom: '12px', right: '12px', borderLeft: 'none', borderTop: 'none' },
  };

  const pos = positions[position];
  const style = Object.entries(pos)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${v}`)
    .join('; ');

  return el('div', {
    attrs: {
      style: `
        position: absolute;
        ${style};
        width: 12px;
        height: 12px;
        border: 1px solid var(--app-line-strong);
        opacity: 0.5;
        pointer-events: none;
      `
    }
  });
}

// ============================================================================
// Pre-built onboarding step content builders
// ============================================================================

export function createWelcomeStepContent(): HTMLElement {
  const container = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 16px 0;
      `
    }
  });

  // Logo using the actual Kisame logo
  const logoContainer = el('div', {
    attrs: {
      style: `
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
      `
    }
  });

  const logo = el('img', {
    attrs: {
      src: '/kisame-logo.png',
      alt: 'Kisame',
      draggable: 'false',
      style: `
        height: 52px;
        width: auto;
        filter: invert(1) drop-shadow(0 0 16px rgba(110, 181, 181, 0.25));
      `
    }
  });

  logoContainer.appendChild(logo);
  container.appendChild(logoContainer);

  // Feature highlights
  const features = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        max-width: 300px;
      `
    }
  });

  const featureItems = [
    { iconType: 'analysis' as const, text: 'AI-powered packet analysis' },
    { iconType: 'timeline' as const, text: 'Session reconstruction & timeline' },
    { iconType: 'shield' as const, text: 'Security insights & threat detection' },
  ];

  featureItems.forEach(({ iconType, text }) => {
    const item = el('div', {
      attrs: {
        style: `
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: var(--app-bg-deep);
          border: 1px solid var(--app-line);
          border-radius: 8px;
          transition: border-color 0.15s, transform 0.15s;
        `
      }
    });

    item.addEventListener('mouseenter', () => {
      item.style.borderColor = 'var(--app-line-strong)';
      item.style.transform = 'translateX(2px)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.borderColor = 'var(--app-line)';
      item.style.transform = 'translateX(0)';
    });

    const iconWrapper = el('div', {
      attrs: {
        style: `
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent-primary-muted);
          border-radius: 6px;
          flex-shrink: 0;
        `
      }
    });
    iconWrapper.appendChild(createFeatureIcon(iconType));

    const textEl = el('span', {
      text,
      attrs: {
        style: `
          font-size: 12px;
          color: var(--app-text-muted);
          text-align: left;
        `
      }
    });

    item.appendChild(iconWrapper);
    item.appendChild(textEl);
    features.appendChild(item);
  });

  container.appendChild(features);

  return container;
}

function createFeatureIcon(type: 'analysis' | 'timeline' | 'shield'): SVGSVGElement {
  const paths: Record<string, string> = {
    analysis: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
    timeline: 'M13 10V3L4 14h7v7l9-11h-7z',
    shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  };

  return svgEl('svg', {
    attrs: {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'var(--accent-primary)',
      'stroke-width': '1.5',
      style: 'width: 14px; height: 14px;'
    },
    children: [
      svgEl('path', {
        attrs: {
          d: paths[type],
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        }
      })
    ]
  }) as SVGSVGElement;
}

export function createWorkspaceSetupContent(): HTMLElement {
  const container = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 8px 0;
      `
    }
  });

  // Description
  const desc = el('p', {
    text: 'Choose a workspace directory where Kisame will store your analysis cases, session data, and exported reports.',
    attrs: {
      style: `
        font-size: 13px;
        color: var(--app-text-muted);
        line-height: 1.55;
        margin: 0;
      `
    }
  });

  // Workspace selector
  const selectorCard = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: var(--app-bg-deep);
        border: 1px solid var(--app-line);
        border-radius: 8px;
      `
    }
  });

  const pathDisplay = el('div', {
    attrs: {
      style: `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: var(--app-surface);
        border: 1px solid var(--app-line);
        border-radius: 6px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--app-text-muted);
      `
    }
  });

  const folderIcon = svgEl('svg', {
    attrs: {
      viewBox: '0 0 20 20',
      fill: 'var(--accent-primary)',
      style: 'width: 16px; height: 16px; flex-shrink: 0; opacity: 0.8;'
    },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z'
        }
      })
    ]
  });

  const pathText = el('span', {
    text: '~/Documents/Kisame',
    attrs: {
      style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'
    }
  });

  pathDisplay.appendChild(folderIcon);
  pathDisplay.appendChild(pathText);

  const browseButton = el('button', {
    text: 'Choose folder...',
    attrs: {
      type: 'button',
      style: `
        font-family: var(--font-ui);
        font-size: 12px;
        font-weight: 500;
        color: var(--app-text);
        background: var(--app-surface);
        border: 1px solid var(--app-line-strong);
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        transition: all 0.15s;
      `
    }
  });

  browseButton.addEventListener('mouseenter', () => {
    browseButton.style.borderColor = 'var(--accent-primary)';
    browseButton.style.color = 'var(--accent-primary)';
  });
  browseButton.addEventListener('mouseleave', () => {
    browseButton.style.borderColor = 'var(--app-line-strong)';
    browseButton.style.color = 'var(--app-text)';
  });

  selectorCard.appendChild(pathDisplay);
  selectorCard.appendChild(browseButton);

  container.appendChild(desc);
  container.appendChild(selectorCard);

  return container;
}

export function createApiKeySetupContent(): HTMLElement {
  const container = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 8px 0;
      `
    }
  });

  // Description
  const desc = el('p', {
    text: 'Connect your AI provider to enable intelligent packet analysis. Your API key is stored locally and never shared.',
    attrs: {
      style: `
        font-size: 13px;
        color: var(--app-text-muted);
        line-height: 1.55;
        margin: 0;
      `
    }
  });

  // Provider selector
  const providerSection = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        gap: 8px;
      `
    }
  });

  const providerLabel = el('span', {
    text: 'PROVIDER',
    attrs: {
      style: `
        font-family: var(--font-mono);
        font-size: 9px;
        font-weight: 500;
        letter-spacing: 0.1em;
        color: var(--app-text-faint);
      `
    }
  });

  const providerButtons = el('div', {
    attrs: {
      style: `
        display: flex;
        gap: 8px;
      `
    }
  });

  const providers = ['Anthropic', 'OpenAI', 'Ollama'];
  let selectedProvider = 0;
  const providerBtns: HTMLButtonElement[] = [];
  
  providers.forEach((provider, index) => {
    const btn = el('button', {
      text: provider,
      attrs: {
        type: 'button',
        'data-provider': provider.toLowerCase(),
        style: getProviderButtonStyle(index === selectedProvider)
      }
    }) as HTMLButtonElement;
    
    btn.addEventListener('click', () => {
      selectedProvider = index;
      providerBtns.forEach((b, i) => {
        b.style.cssText = getProviderButtonStyle(i === selectedProvider);
      });
    });
    
    providerBtns.push(btn);
    providerButtons.appendChild(btn);
  });

  providerSection.appendChild(providerLabel);
  providerSection.appendChild(providerButtons);

  // API Key input
  const inputSection = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        gap: 8px;
      `
    }
  });

  const inputLabel = el('span', {
    text: 'API KEY',
    attrs: {
      style: `
        font-family: var(--font-mono);
        font-size: 9px;
        font-weight: 500;
        letter-spacing: 0.1em;
        color: var(--app-text-faint);
      `
    }
  });

  const inputWrapper = el('div', {
    attrs: {
      style: `
        position: relative;
      `
    }
  });

  const input = el('input', {
    attrs: {
      type: 'password',
      placeholder: 'sk-ant-...',
      style: `
        width: 100%;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--app-text);
        background: var(--app-bg-deep);
        border: 1px solid var(--app-line);
        border-radius: 6px;
        padding: 10px 40px 10px 12px;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
        box-sizing: border-box;
      `
    }
  }) as HTMLInputElement;

  input.addEventListener('focus', () => {
    input.style.borderColor = 'var(--accent-primary)';
    input.style.boxShadow = '0 0 0 2px rgba(110, 181, 181, 0.1)';
  });
  input.addEventListener('blur', () => {
    input.style.borderColor = 'var(--app-line)';
    input.style.boxShadow = 'none';
  });

  // Toggle visibility button
  const toggleBtn = el('button', {
    attrs: {
      type: 'button',
      style: `
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--app-text-faint);
        transition: color 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      `
    }
  });

  const eyeIcon = svgEl('svg', {
    attrs: {
      viewBox: '0 0 20 20',
      fill: 'currentColor',
      style: 'width: 18px; height: 18px;'
    },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M10 12a2 2 0 100-4 2 2 0 000 4z'
        }
      }),
      svgEl('path', {
        attrs: {
          'fill-rule': 'evenodd',
          d: 'M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z',
          'clip-rule': 'evenodd'
        }
      })
    ]
  });

  toggleBtn.appendChild(eyeIcon);
  toggleBtn.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    toggleBtn.style.color = input.type === 'text' ? 'var(--accent-primary)' : 'var(--app-text-faint)';
  });
  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.color = 'var(--app-text-muted)';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.color = input.type === 'text' ? 'var(--accent-primary)' : 'var(--app-text-faint)';
  });

  inputWrapper.appendChild(input);
  inputWrapper.appendChild(toggleBtn);

  inputSection.appendChild(inputLabel);
  inputSection.appendChild(inputWrapper);

  container.appendChild(desc);
  container.appendChild(providerSection);
  container.appendChild(inputSection);

  return container;
}

function getProviderButtonStyle(isSelected: boolean): string {
  return `
    flex: 1;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    ${isSelected
      ? `
        color: var(--accent-primary);
        background: var(--accent-primary-muted);
        border: 1px solid rgba(110, 181, 181, 0.4);
      `
      : `
        color: var(--app-text-muted);
        background: var(--app-bg-deep);
        border: 1px solid var(--app-line);
      `}
  `;
}

export function createFinishStepContent(): HTMLElement {
  const container = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 20px 0;
      `
    }
  });

  // Success checkmark
  const checkContainer = el('div', {
    attrs: {
      style: `
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--accent-primary-muted);
        border: 2px solid var(--accent-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
      `
    }
  });

  const checkIcon = svgEl('svg', {
    attrs: {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'var(--accent-primary)',
      'stroke-width': '2.5',
      style: 'width: 28px; height: 28px;'
    },
    children: [
      svgEl('path', {
        attrs: {
          d: 'M5 13l4 4L19 7',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        }
      })
    ]
  });

  checkContainer.appendChild(checkIcon);
  container.appendChild(checkContainer);

  // Quick tips
  const tips = el('div', {
    attrs: {
      style: `
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        max-width: 300px;
      `
    }
  });

  const tipsTitle = el('span', {
    text: 'QUICK TIPS',
    attrs: {
      style: `
        font-family: var(--font-mono);
        font-size: 9px;
        font-weight: 500;
        letter-spacing: 0.1em;
        color: var(--app-text-faint);
        margin-bottom: 4px;
      `
    }
  });

  tips.appendChild(tipsTitle);

  const tipItems = [
    'Drop a .pcap file or start a live capture',
    'Use the chat to ask questions about traffic',
    'Create workflows for automated analysis',
  ];

  tipItems.forEach((tip, index) => {
    const item = el('div', {
      attrs: {
        style: `
          display: flex;
          align-items: flex-start;
          gap: 10px;
          text-align: left;
          padding: 10px 12px;
          background: var(--app-bg-deep);
          border: 1px solid var(--app-line);
          border-radius: 6px;
        `
      }
    });

    const num = el('span', {
      text: String(index + 1),
      attrs: {
        style: `
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--accent-primary-muted);
          color: var(--accent-primary);
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        `
      }
    });

    const text = el('span', {
      text: tip,
      attrs: {
        style: `
          font-size: 12px;
          color: var(--app-text-muted);
          line-height: 1.4;
        `
      }
    });

    item.appendChild(num);
    item.appendChild(text);
    tips.appendChild(item);
  });

  container.appendChild(tips);
  return container;
}

// ============================================================================
// Convenience function to create a default onboarding flow
// ============================================================================

export function createDefaultOnboarding(options?: {
  onComplete?: () => void;
  onSkip?: () => void;
}): OnboardingManager {
  const steps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to Kisame',
      subtitle: 'Your AI-powered network forensics companion',
      content: createWelcomeStepContent(),
    },
    {
      id: 'workspace',
      title: 'Set up your workspace',
      subtitle: 'Choose where to store your analysis data',
      content: createWorkspaceSetupContent(),
    },
    {
      id: 'api-key',
      title: 'Connect AI provider',
      subtitle: 'Enable intelligent packet analysis',
      content: createApiKeySetupContent(),
    },
    {
      id: 'finish',
      title: "You're all set!",
      subtitle: 'Start analyzing network traffic',
      content: createFinishStepContent(),
    },
  ];

  return new OnboardingManager({
    steps,
    onComplete: options?.onComplete,
    onSkip: options?.onSkip,
    allowSkip: true,
  });
}
