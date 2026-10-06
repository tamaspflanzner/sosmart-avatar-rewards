// Avatar sprites and backgrounds are layered with exact CSS transforms. Keep
// their original transparent pixels and the same native image error handling.
export default function CosmeticImage({ alt = "", ...props }) {
  // eslint-disable-next-line @next/next/no-img-element -- Intentional native sprite rendering.
  return <img {...props} alt={alt} />;
}
