import { useImage } from '../lib/image.js';

export function BgImage({ url }) {
  const { src } = useImage(url);
  return src ? <img src={src} alt="" /> : null;
}
