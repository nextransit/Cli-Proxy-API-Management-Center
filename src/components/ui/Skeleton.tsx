import type { CSSProperties, ReactNode } from 'react';
import styles from './Skeleton.module.scss';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  children?: ReactNode;
}

export function Skeleton({
  width,
  height,
  borderRadius,
  className = '',
  children,
}: SkeletonProps) {
  const style: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
  };

  return (
    <div className={`${styles.skeleton} ${className}`} style={style}>
      {children}
    </div>
  );
}

interface SkeletonBlockProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function SkeletonBlock({ width = '100%', height = 16, className = '' }: SkeletonBlockProps) {
  return <Skeleton width={width} height={height} className={className} />;
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return (
    <div className={`${styles.textContainer} ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          width={i === lines - 1 ? '60%' : '100%'}
          height={14}
        />
      ))}
    </div>
  );
}
