// Reusable SVG close/delete icon — clean X with rounded caps
export function CloseIcon({ size = 10, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <line x1="2" y1="2" x2="8" y2="8" />
      <line x1="8" y1="2" x2="2" y2="8" />
    </svg>
  );
}

// Pencil icon for edit affordances
export function PencilIcon({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5 L13.5 4.5 L5 13 L2.5 13.5 L3 11 Z" />
      <line x1="10" y1="4" x2="12" y2="6" />
    </svg>
  );
}
