/** Animated logo that expands and contracts (breathing pulse).
 *
 * Replaces border-based spinners throughout the app with the Basebuild logo
 * scaling between 0.85× and 1.15× on a 1.4s ease-in-out loop. */
import iconUrl from "../../assets/icon.png";

type LogoPulseProps = {
  /** Pixel size of the square logo. */
  size?: number;
  /** Extra class names for layout context (e.g. "splash-spinner"). */
  className?: string;
};

export function LogoPulse({ size = 24, className }: LogoPulseProps) {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      className={`logo-pulse${className ? ` ${className}` : ""}`}
      alt=""
      aria-hidden="true"
    />
  );
}
