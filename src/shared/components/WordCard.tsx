export interface WordCardProps {
  reading: string;
  isSpace: boolean;
  isNewline: boolean;
  isSelected: boolean;
  cardClass?: string;
  style?: React.CSSProperties;
}

export default function WordCard({
  reading,
  isSpace,
  isNewline,
  isSelected = false,
  cardClass,
  style,
}: WordCardProps) {
  const cls = [cardClass || 'wc-card', isSelected ? 'wc-card-selected' : '']
    .filter(Boolean)
    .join(' ');

  if (isSpace) {
    return <span className={`${cls} wc-card-dash`} style={style}>␣</span>;
  }

  if (isNewline) {
    return <span className={`${cls} wc-card-dash`} style={style}>¶</span>;
  }

  return <span className={cls} style={style}>{reading}</span>;
}
