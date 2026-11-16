// How a card looks, as plain data (a "spec"). The renderer (render.js) draws a spec;
// this file decides what goes in one. Keeping it pure means the AI can return a spec,
// we can check and repair it here, and tests can cover it without a canvas.
//
// A spec:
// { theme, occasion, customLabel, relation, tone, lang, format, palette, motifs,
//   font, seed, heading, message, signoff, to, from, photo }

export const FORMATS = {
  post: { w: 1080, h: 1350, en: 'Post 4:5', hint: 'WhatsApp, Instagram' },
  status: { w: 1080, h: 1920, en: 'Status 9:16', hint: 'WhatsApp Status, Stories' },
  square: { w: 1080, h: 1080, en: 'Square 1:1', hint: 'Profile, Facebook' },
};

// Where each motif sits, and how much room it takes from the text (px at 1080 wide).
//   top / bottom: a band across the card     frame: a border that insets the text
//   corners: bottom (and sometimes top) corners   scatter / bg: behind everything
export const MOTIFS = {
  'string-lights': { zone: 'top', h: 190 }, toran: { zone: 'top', h: 210 }, bunting: { zone: 'top', h: 170 },
  lanterns: { zone: 'top', h: 300, side: true }, kites: { zone: 'top', h: 300, side: true }, sun: { zone: 'top', h: 290, side: true },
  crescent: { zone: 'top', h: 330, side: true }, birds: { zone: 'top', h: 200, side: true }, clouds: { zone: 'top', h: 220 },
  fireworks: { zone: 'top', h: 340 }, 'moon-full': { zone: 'top', h: 330 },
  rangoli: { zone: 'bottom', h: 320 }, diyas: { zone: 'bottom', h: 160 }, skyline: { zone: 'bottom', h: 380 },
  kolam: { zone: 'bottom', h: 300 }, pot: { zone: 'bottom', h: 300 }, sugarcane: { zone: 'bottom', h: 360, side: true },
  wheat: { zone: 'bottom', h: 330, side: true }, bonfire: { zone: 'bottom', h: 330 }, pookalam: { zone: 'bottom', h: 390 },
  modaks: { zone: 'bottom', h: 290 }, flute: { zone: 'bottom', h: 170 }, lotus: { zone: 'bottom', h: 290 },
  'xmas-tree': { zone: 'bottom', h: 420, side: true }, gifts: { zone: 'bottom', h: 200 }, kalash: { zone: 'bottom', h: 330 },
  cake: { zone: 'bottom', h: 330 }, house: { zone: 'bottom', h: 360 }, books: { zone: 'bottom', h: 260 },
  'sunrise-water': { zone: 'bottom', h: 380 }, rakhi: { zone: 'bottom', h: 300 }, marigolds: { zone: 'bottom', h: 200 },
  tiranga: { zone: 'bottom', h: 300 }, laurel: { zone: 'bottom', h: 340 }, balloons: { zone: 'scatter', h: 0, side: true },
  'frame-gold': { zone: 'frame', inset: 70 }, 'arch-frame': { zone: 'frame', inset: 150, arch: true }, kasavu: { zone: 'frame', inset: 70 },
  'laal-paar': { zone: 'frame', inset: 80 }, 'florals-corner': { zone: 'corners', h: 0 }, 'alpana-corners': { zone: 'corners', h: 0 },
  'mehndi-corners': { zone: 'corners', h: 0 }, leaves: { zone: 'corners', h: 0 }, 'peacock-feathers': { zone: 'corners', h: 0 },
  sparkles: { zone: 'scatter', h: 0 }, confetti: { zone: 'scatter', h: 0 }, splashes: { zone: 'scatter', h: 0 }, stars: { zone: 'scatter', h: 0 },
  hearts: { zone: 'scatter', h: 0 }, snow: { zone: 'scatter', h: 0 }, shiuli: { zone: 'scatter', h: 0 }, rain: { zone: 'scatter', h: 0 },
  bandhani: { zone: 'bg', h: 0 }, 'night-sky': { zone: 'bg', h: 0 }, sunburst: { zone: 'bg', h: 0 }, chakra: { zone: 'bg', h: 0 },
};
export const MOTIF_NAMES = Object.keys(MOTIFS);

// Palettes: bg gradient top→bottom, ink (heading), sub (message), c (accent colours).
const P = (bg0, bg1, ink, sub, ...c) => ({ bg: [bg0, bg1], ink, sub, c });

export const THEMES = {
  diwali: { motifs: [['string-lights', 'rangoli', 'diyas', 'sparkles'], ['toran', 'diyas', 'sparkles'], ['lanterns', 'rangoli', 'sparkles']], font: 'display',
    palettes: [P('#1A0B2E', '#3B0F3F', '#FFD27A', '#F6E7FF', '#FF8A1F', '#E8336D', '#FFD27A', '#7B2CBF'), P('#0B1E3A', '#123B5E', '#FFC94D', '#EAF2FF', '#FFC94D', '#FF6B6B', '#3DD6C6', '#FFFFFF'), P('#5A0A14', '#8C1424', '#FFE3A3', '#FFF1E0', '#FFB627', '#FFFFFF', '#2EC4B6', '#FF6F59')] },
  holi: { motifs: [['splashes'], ['splashes', 'confetti']], font: 'display',
    palettes: [P('#FFFDF8', '#FFF3F8', '#B0125B', '#3A2A40', '#FF2E88', '#FFC400', '#20C997', '#3F7BFF', '#9B5DE5'), P('#FFFFFF', '#F3FBFF', '#1A4FD6', '#2A2F45', '#00B4D8', '#FF006E', '#FFBE0B', '#8338EC'), P('#2B1B3D', '#3D1E4F', '#FFE14D', '#FFFFFF', '#FF4FA3', '#FFE14D', '#3BF4C1', '#59A5FF')] },
  rakhi: { motifs: [['bandhani', 'rakhi'], ['rakhi', 'florals-corner']], font: 'display',
    palettes: [P('#FFF4E6', '#FFE1C2', '#B5121B', '#5A2A12', '#E63946', '#F4A300', '#2A9D8F', '#FFFFFF'), P('#FCE4EC', '#F8BBD0', '#8E1550', '#4A1030', '#AD1457', '#FFB300', '#00897B', '#FFFFFF'), P('#0E3B43', '#14545E', '#FFD166', '#F1FAEE', '#FFD166', '#EF476F', '#06D6A0', '#F1FAEE')] },
  eid: { motifs: [['crescent', 'lanterns', 'skyline', 'frame-gold', 'stars'], ['crescent', 'stars', 'arch-frame'], ['lanterns', 'stars', 'frame-gold', 'skyline']], font: 'serif',
    palettes: [P('#062C30', '#0B4A50', '#F5D78E', '#E8F6F3', '#F5D78E', '#D4A53C', '#0F6B70', '#FFFFFF'), P('#141B3C', '#2A2F6B', '#FFE6A7', '#EEF0FF', '#FFE6A7', '#C9A227', '#3C4AA0', '#FFFFFF'), P('#F4F7F2', '#DDEBE2', '#0B5A45', '#22352D', '#C9A227', '#0B5A45', '#7FB7A0', '#FFFFFF')] },
  harvest: { motifs: [['sun', 'kites', 'kolam', 'pot', 'sugarcane'], ['kites', 'wheat', 'marigolds'], ['sun', 'wheat', 'kites']], font: 'display',
    palettes: [P('#FFF6D6', '#FFD98A', '#8A2C02', '#4A2A0A', '#E85D04', '#2B9348', '#D00000', '#FFB703'), P('#E9F5DB', '#B5E48C', '#1B4332', '#2D3A20', '#F77F00', '#2D6A4F', '#D62828', '#FFB703'), P('#3A0CA3', '#560BAD', '#FFD60A', '#FFFFFF', '#FFB703', '#52B788', '#F72585', '#FFD60A')] },
  bonfire: { motifs: [['bonfire', 'kites', 'stars'], ['bonfire', 'sparkles']], font: 'display',
    palettes: [P('#1B1035', '#3A1C4A', '#FFC93C', '#FFF1DE', '#FF7B00', '#FFC93C', '#E63946', '#2A9D8F'), P('#2D0F0F', '#5B1A0F', '#FFD166', '#FFF4E0', '#FF7B00', '#FFD166', '#06D6A0', '#EF476F')] },
  onam: { motifs: [['kasavu', 'pookalam', 'florals-corner'], ['kasavu', 'pookalam']], font: 'display',
    palettes: [P('#FFFBEA', '#FFF0C2', '#7A3E00', '#3D2A10', '#FFB000', '#FF6B00', '#C1121F', '#FFFFFF', '#2D6A4F'), P('#0F3D2E', '#1B5E45', '#FFD23F', '#F1F7ED', '#FFD23F', '#FF7F11', '#E63946', '#FFFFFF', '#8AC926'), P('#F7F3E8', '#EADDC0', '#9C2A00', '#3A2414', '#F9A620', '#E2711D', '#B23A48', '#FFFFFF', '#548C2F')] },
  durga: { motifs: [['laal-paar', 'alpana-corners', 'shiuli'], ['laal-paar', 'sunburst', 'shiuli']], font: 'serif',
    palettes: [P('#FFFFFF', '#FFF3EE', '#C1121F', '#3A1010', '#C1121F', '#E0A100', '#FFFFFF', '#7A0A12'), P('#C1121F', '#8E0E17', '#FFFFFF', '#FFF1E6', '#FFFFFF', '#FFB703', '#C1121F', '#5C0A10'), P('#2B0A3D', '#4A0E4E', '#FFC94D', '#FCEFF9', '#FF4D6D', '#FFC94D', '#FFFFFF', '#2B0A3D')] },
  ganesh: { motifs: [['toran', 'sunburst', 'modaks'], ['toran', 'modaks', 'sparkles']], font: 'display',
    palettes: [P('#FFF1D6', '#FFD39A', '#A4161A', '#4A2008', '#FF8C00', '#FFD000', '#2B9348', '#A4161A'), P('#3D0C02', '#6A1B0A', '#FFD166', '#FFF4E0', '#FF9F1C', '#FFD166', '#55A630', '#FFFFFF'), P('#FDE2E4', '#FAD2E1', '#9D0208', '#3C1518', '#F48C06', '#FFBA08', '#38B000', '#9D0208')] },
  krishna: { motifs: [['peacock-feathers', 'flute', 'stars'], ['peacock-feathers', 'frame-gold', 'flute']], font: 'serif',
    palettes: [P('#0B2545', '#13315C', '#FFD166', '#EEF4ED', '#1B998B', '#FFD166', '#2E86AB', '#7B2CBF'), P('#FFF8E7', '#FCE7C0', '#123C69', '#2B2B2B', '#1B998B', '#E09F3E', '#2E86AB', '#540B0E')] },
  shiva: { motifs: [['night-sky', 'crescent', 'diyas'], ['night-sky', 'moon-full', 'lotus']], font: 'serif',
    palettes: [P('#0D1B2A', '#1B263B', '#E0E1DD', '#C9D1E0', '#E0E1DD', '#778DA9', '#FFB703', '#FFFFFF'), P('#10002B', '#240046', '#FFD166', '#E0D7F5', '#FFD166', '#9D4EDD', '#FFFFFF', '#C77DFF')] },
  devotional: { motifs: [['sunburst', 'lotus', 'diyas', 'frame-gold'], ['toran', 'lotus', 'sparkles']], font: 'serif',
    palettes: [P('#FFF3E0', '#FFD8A8', '#9A1C00', '#4A2A10', '#FF7B00', '#FFC300', '#C9184A', '#2D6A4F'), P('#5A0F0F', '#7F1D1D', '#FFD27A', '#FFF1E0', '#FFB627', '#FF6F59', '#FFFFFF', '#2EC4B6')] },
  lotus: { motifs: [['lotus', 'moon-full', 'stars'], ['lotus', 'sunburst']], font: 'serif',
    palettes: [P('#FFF7F3', '#FDE2E4', '#8E2C48', '#3B2A30', '#E5989B', '#FFB4A2', '#6D9773', '#FFFFFF'), P('#102A43', '#243B53', '#F7D488', '#E6EEF5', '#F4A6B7', '#F7D488', '#7FB7A0', '#FFFFFF')] },
  gurpurab: { motifs: [['string-lights', 'diyas', 'frame-gold'], ['diyas', 'sparkles', 'frame-gold']], font: 'serif',
    palettes: [P('#0B1F3A', '#16365F', '#FFC94D', '#EEF3FA', '#FF9F1C', '#FFC94D', '#FFFFFF', '#2EC4B6'), P('#FFF6E5', '#FFE3B3', '#7A2E00', '#3D2410', '#FF9F1C', '#1D3557', '#E09F3E', '#FFFFFF')] },
  christmas: { motifs: [['snow', 'xmas-tree', 'gifts'], ['snow', 'stars', 'xmas-tree']], font: 'serif',
    palettes: [P('#0B3D2E', '#14532D', '#FFE8A3', '#F1FAEE', '#E63946', '#FFE8A3', '#2A9D8F', '#FFFFFF'), P('#7F1D1D', '#991B1B', '#FFFFFF', '#FFF1E6', '#FFFFFF', '#FFD166', '#2D6A4F', '#F4A261'), P('#F8FAFC', '#E2ECF5', '#9B1C1C', '#1F2937', '#C1121F', '#2D6A4F', '#E0A100', '#FFFFFF')] },
  newyear: { motifs: [['fireworks', 'confetti'], ['fireworks', 'stars', 'sparkles']], font: 'display',
    palettes: [P('#0B0F2B', '#1E1B4B', '#FFD166', '#EDEBFF', '#FFD166', '#FF5D8F', '#3BCEAC', '#9D79FF'), P('#000814', '#001D3D', '#FFC300', '#E8F1FF', '#FFC300', '#FF006E', '#00F5D4', '#FFFFFF')] },
  'newyear-trad': { motifs: [['toran', 'kalash', 'rangoli'], ['toran', 'rangoli', 'sparkles']], font: 'display',
    palettes: [P('#FFF6E0', '#FFDFA3', '#8A1C00', '#4A2A0A', '#FF7B00', '#FFC300', '#2B9348', '#C9184A'), P('#1B4332', '#2D6A4F', '#FFD166', '#F1FAEE', '#FFD166', '#FF7B00', '#95D5B2', '#FFFFFF')] },
  national: { motifs: [['tiranga', 'chakra'], ['tiranga', 'sparkles']], font: 'display',
    palettes: [P('#FFFFFF', '#F4F7FB', '#0A2A66', '#1F2937', '#FF9933', '#FFFFFF', '#138808', '#000080'), P('#FFF7EE', '#EEF7EE', '#000080', '#1F2937', '#FF9933', '#FFFFFF', '#138808', '#000080')] },
  wedding: { motifs: [['toran', 'arch-frame', 'mehndi-corners'], ['frame-gold', 'florals-corner', 'sparkles'], ['toran', 'arch-frame', 'florals-corner']], font: 'serif',
    palettes: [P('#4A0D1A', '#7A1430', '#F3C969', '#FFF0E6', '#F3C969', '#FF8C42', '#FFD23F', '#2E7D32'), P('#FFF8F0', '#FBE3D3', '#8C1C3A', '#3B1A20', '#C9A227', '#E85D04', '#FFB703', '#2E7D32'), P('#0B3D3A', '#145C55', '#F7D488', '#EFFAF7', '#F7D488', '#FF7B54', '#FFD23F', '#9BE15D')] },
  love: { motifs: [['hearts', 'florals-corner'], ['hearts', 'frame-gold', 'sparkles'], ['florals-corner', 'sparkles']], font: 'script',
    palettes: [P('#FFF0F3', '#FFD6E0', '#B0103F', '#4A1A28', '#E5383B', '#FF8FA3', '#C9184A', '#FFFFFF'), P('#3D0C1A', '#6B1230', '#FFC2D1', '#FFEFF3', '#FF4D6D', '#FFC2D1', '#F9DC5C', '#FFFFFF'), P('#FDF6EC', '#F6E2CC', '#7A1F3D', '#3B2A2A', '#D8A48F', '#BB4D6E', '#6D8B74', '#FFFFFF')] },
  birthday: { motifs: [['bunting', 'confetti', 'cake'], ['balloons', 'confetti', 'stars'], ['bunting', 'balloons', 'confetti']], font: 'display',
    palettes: [P('#FFF4FB', '#FFE0F0', '#C2185B', '#3A1E2E', '#FF4D8D', '#FFC233', '#3ACFD5', '#7A5CFA', '#FF8A3D'), P('#12263A', '#1D3E5C', '#FFD23F', '#EAF4FF', '#FFD23F', '#FF5D8F', '#3BCEAC', '#9D79FF', '#FF9F45'), P('#F1FFF7', '#D7F5E6', '#0B7A5A', '#1E3A30', '#FF6B6B', '#FFD93D', '#4D96FF', '#6BCB77', '#B37FEB')] },
  baby: { motifs: [['clouds', 'stars', 'balloons'], ['moon-full', 'clouds', 'stars']], font: 'display',
    palettes: [P('#F0F7FF', '#DCEBFF', '#2B59C3', '#2A3550', '#8EC5FF', '#FFD6E7', '#FFE89A', '#B5EAD7'), P('#FFF5F8', '#FFE1EC', '#C2185B', '#3A2430', '#FFB3C7', '#A0D8F1', '#FFE89A', '#B5EAD7')] },
  home: { motifs: [['toran', 'house', 'sparkles'], ['toran', 'kalash', 'rangoli']], font: 'display',
    palettes: [P('#FFF8EC', '#FFE8C2', '#8A3B00', '#4A2E14', '#FF8C00', '#FFD000', '#2B9348', '#C1121F'), P('#F1F7F2', '#D8EBDD', '#1B4332', '#2A3A2E', '#F77F00', '#FFD166', '#2D6A4F', '#BC4749')] },
  mother: { motifs: [['florals-corner', 'hearts'], ['florals-corner', 'leaves', 'sparkles']], font: 'serif',
    palettes: [P('#FFF5F7', '#FDE2E8', '#A4133C', '#3F2A30', '#FF8FAB', '#FB6F92', '#8AA67A', '#FFFFFF'), P('#FBF6EF', '#F1E3CF', '#7A3E48', '#3B302A', '#E8A0BF', '#BA7BA1', '#7D9D6E', '#FFFFFF')] },
  father: { motifs: [['frame-gold', 'stars', 'leaves'], ['sunburst', 'stars']], font: 'serif',
    palettes: [P('#0F2A44', '#1D4E89', '#F4D58D', '#E8EEF5', '#F4D58D', '#7FB7D9', '#FFFFFF', '#E07A5F'), P('#F5F1E8', '#E4DAC6', '#1D3557', '#2B2B2B', '#457B9D', '#E9C46A', '#2A9D8F', '#FFFFFF')] },
  friendship: { motifs: [['bunting', 'hearts', 'confetti'], ['confetti', 'stars']], font: 'display',
    palettes: [P('#FFF9E6', '#FFE9A8', '#C2410C', '#3B2A10', '#FF6B6B', '#4D96FF', '#6BCB77', '#FFD93D'), P('#1A1A40', '#270082', '#FFD93D', '#EFEAFF', '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF')] },
  teacher: { motifs: [['books', 'stars', 'leaves'], ['books', 'laurel']], font: 'serif',
    palettes: [P('#F4F8F1', '#DDEAD3', '#1B4332', '#2B3A2E', '#E76F51', '#F4A261', '#2A9D8F', '#264653'), P('#0E2A47', '#173F5F', '#F6D55C', '#E9F1F7', '#F6D55C', '#ED553B', '#3CAEA3', '#FFFFFF')] },
  thanks: { motifs: [['florals-corner', 'leaves'], ['florals-corner', 'sparkles']], font: 'serif',
    palettes: [P('#FFFBF2', '#FCEBD2', '#8C3B12', '#3D2B1F', '#E76F51', '#F4A261', '#7D9D6E', '#FFFFFF'), P('#EEF6F3', '#D3E8E0', '#1F5F4A', '#25352F', '#F28482', '#F6BD60', '#84A59D', '#FFFFFF')] },
  getwell: { motifs: [['sun', 'florals-corner', 'leaves'], ['florals-corner', 'leaves']], font: 'display',
    palettes: [P('#FFFBEA', '#FFF0C7', '#B45309', '#3D3420', '#FFB703', '#FB8500', '#8AC926', '#FFFFFF'), P('#EFF8FF', '#D8EEFF', '#1D4ED8', '#25324A', '#FFB703', '#7DD3FC', '#86EFAC', '#FFFFFF')] },
  sympathy: { motifs: [['lotus', 'leaves'], ['leaves']], font: 'serif',
    palettes: [P('#F4F5F2', '#E3E6DF', '#3F4A42', '#2E3530', '#C9CEC4', '#9AA899', '#FFFFFF', '#6B7B6E'), P('#1F2A2E', '#2C3A3F', '#E8E3D9', '#D3D9D6', '#C2C9C4', '#8FA39B', '#FFFFFF', '#E8E3D9')] },
  achievement: { motifs: [['laurel', 'stars', 'confetti'], ['laurel', 'fireworks'], ['confetti', 'stars', 'sparkles']], font: 'display',
    palettes: [P('#0B1E3A', '#16325C', '#FFD166', '#EAF2FF', '#FFD166', '#EF476F', '#06D6A0', '#118AB2'), P('#FFFBEB', '#FEF0C7', '#92400E', '#3B2F1E', '#F59E0B', '#EF4444', '#10B981', '#3B82F6'), P('#2A0845', '#4A1A6B', '#FFD700', '#F3EAFF', '#FFD700', '#FF6B9A', '#4ADEDE', '#FFFFFF')] },
  farewell: { motifs: [['sun', 'leaves', 'birds'], ['florals-corner', 'birds']], font: 'serif',
    palettes: [P('#FFF4E6', '#FFD8B0', '#9C3D00', '#3F2A1A', '#FF9F1C', '#E76F51', '#2A9D8F', '#FFFFFF'), P('#16324F', '#2A4D69', '#F6D55C', '#E8EEF5', '#F6D55C', '#ED553B', '#3CAEA3', '#FFFFFF')] },
  morning: { motifs: [['sun', 'birds', 'leaves'], ['sun', 'florals-corner']], font: 'display',
    palettes: [P('#FFF9E5', '#FFE3A3', '#B45309', '#3D3420', '#FFB703', '#FB8500', '#8AC926', '#FFFFFF'), P('#E8F6FF', '#FFF1D6', '#0E7490', '#25324A', '#FFB703', '#FF8FA3', '#8AC926', '#FFFFFF')] },
  night: { motifs: [['night-sky', 'crescent', 'stars'], ['night-sky', 'moon-full', 'clouds']], font: 'serif',
    palettes: [P('#0B1026', '#1B2448', '#FFE8A3', '#DDE3F5', '#FFE8A3', '#8EA4F2', '#FFFFFF', '#C3B1E1'), P('#120F2D', '#2B1D52', '#F8D57E', '#E6DDF5', '#F8D57E', '#A78BFA', '#FFFFFF', '#F0ABFC')] },
  moon: { motifs: [['night-sky', 'moon-full', 'diyas'], ['night-sky', 'crescent', 'lanterns']], font: 'serif',
    palettes: [P('#2B0A1E', '#4A0E33', '#FFD6A5', '#FCE9F1', '#FFD6A5', '#FF5D8F', '#FFC233', '#FFFFFF'), P('#0B1026', '#1B2448', '#FFE8A3', '#DDE3F5', '#FFE8A3', '#FF8FA3', '#FFC233', '#FFFFFF')] },
  sunrise: { motifs: [['sunrise-water', 'diyas'], ['sunrise-water', 'birds']], font: 'display',
    palettes: [P('#FFE5B4', '#FF9E6D', '#7A1F00', '#3F1C0F', '#FF7B00', '#FFC300', '#3A86FF', '#FFFFFF'), P('#FFD6A5', '#FFADAD', '#8B1E3F', '#3F1C24', '#FF7B00', '#FFD166', '#118AB2', '#FFFFFF')] },
  monsoon: { motifs: [['rain', 'leaves', 'florals-corner'], ['clouds', 'rain', 'leaves']], font: 'display',
    palettes: [P('#E9F7EF', '#C8EBD5', '#1B5E20', '#22372A', '#43AA8B', '#90BE6D', '#F94144', '#F9C74F'), P('#E3F2FD', '#BBDEFB', '#0D47A1', '#1E2A3A', '#4CC9F0', '#43AA8B', '#F72585', '#FFFFFF')] },
  spring: { motifs: [['florals-corner', 'kites', 'leaves'], ['florals-corner', 'sparkles', 'leaves']], font: 'display',
    palettes: [P('#FFFBE6', '#FFF0A8', '#9A6700', '#3D3420', '#FFD000', '#FF8C00', '#8AC926', '#FFFFFF'), P('#F4FFF0', '#DFF7D2', '#2D6A4F', '#2B3A2E', '#FFD000', '#FF85A1', '#52B788', '#FFFFFF')] },
  lights: { motifs: [['string-lights', 'sparkles', 'rangoli'], ['toran', 'sparkles'], ['confetti', 'stars', 'sparkles']], font: 'display',
    palettes: [P('#1E1035', '#3A1757', '#FFD27A', '#F6E7FF', '#FF8A1F', '#E8336D', '#FFD27A', '#3DD6C6'), P('#FFF6EC', '#FFE1C7', '#A23B00', '#3D2A1C', '#FF8A1F', '#E8336D', '#2EC4B6', '#7B2CBF')] },
};

export const THEME_IDS = Object.keys(THEMES);
export const FONTS = ['display', 'serif', 'script'];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Relative luminance 0..1, used to decide dark or light text treatment. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
/** WCAG contrast ratio between two colours. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const isDark = (palette) => luminance(palette.bg[0]) + luminance(palette.bg[1]) < 0.6;

/** Small seeded random numbers so the same seed always draws the same card. */
export function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Style words from a request ("traditional", "classy") nudge the font and palette. */
const STYLE_FONT = { traditional: 'display', elegant: 'serif', royal: 'serif', minimal: 'serif', playful: 'display', romantic: 'script' };

/**
 * A fresh design for an occasion. `variant` picks among the theme's motif sets and
 * palettes, so variants 0, 1, 2 give three different-looking cards.
 */
export function designFor({ theme = 'lights', variant = 0, style = null, tone = 'warm', lang = 'en', seed } = {}) {
  const T = THEMES[theme] || THEMES.lights;
  const motifs = T.motifs[variant % T.motifs.length];
  const palette = T.palettes[(variant + Math.floor(variant / T.motifs.length)) % T.palettes.length];
  let font = STYLE_FONT[style] || T.font;
  if (tone === 'funny') font = 'display';
  if (font === 'script' && lang !== 'en') font = 'serif';
  return { theme: THEMES[theme] ? theme : 'lights', motifs: [...motifs], palette: clonePalette(palette), font, seed: seed ?? variant * 101 + 7 };
}

const clonePalette = (p) => ({ bg: [...p.bg], ink: p.ink, sub: p.sub, c: [...p.c] });

/**
 * Make any spec safe to draw: AI output, an old saved card, or a hand edit. Unknown
 * motifs are dropped, colours must be #RRGGBB, text that would be unreadable on its
 * background is replaced with the theme's colours, and lengths are capped.
 */
export function sanitizeSpec(input = {}) {
  const s = { ...input };
  s.theme = THEMES[s.theme] ? s.theme : 'lights';
  const T = THEMES[s.theme];
  s.format = FORMATS[s.format] ? s.format : 'post';
  s.font = FONTS.includes(s.font) ? s.font : T.font;
  if (s.font === 'script' && s.lang && s.lang !== 'en') s.font = 'serif';
  s.motifs = [...new Set((Array.isArray(s.motifs) ? s.motifs : []).filter((m) => MOTIFS[m]))].slice(0, 6);
  if (!s.motifs.length) s.motifs = [...T.motifs[0]];
  // Only one frame, one top band and one bottom band, or they draw over each other.
  const seen = new Set();
  s.motifs = s.motifs.filter((m) => {
    const z = MOTIFS[m].zone;
    const slot = z === 'frame' || z === 'bg' ? z : (z === 'top' || z === 'bottom') && !MOTIFS[m].side ? z : null;
    if (!slot) return true;
    if (seen.has(slot)) return false;
    seen.add(slot);
    return true;
  });
  const p = s.palette || {};
  const ok = Array.isArray(p.bg) && p.bg.length === 2 && p.bg.every((c) => HEX.test(c)) && HEX.test(p.ink) && HEX.test(p.sub);
  s.palette = ok ? { bg: [...p.bg], ink: p.ink, sub: p.sub, c: (Array.isArray(p.c) ? p.c : []).filter((c) => HEX.test(c)).slice(0, 6) } : clonePalette(T.palettes[0]);
  if (s.palette.c.length < 3) s.palette.c = [...T.palettes[0].c];
  // Readability: heading and message must stand out against both ends of the gradient.
  const worst = (col) => Math.min(contrast(col, s.palette.bg[0]), contrast(col, s.palette.bg[1]));
  if (worst(s.palette.ink) < 3) s.palette.ink = isDark(s.palette) ? '#FFF4D6' : '#2A1530';
  if (worst(s.palette.sub) < 4.5) s.palette.sub = isDark(s.palette) ? '#FFFFFF' : '#1F1A24';
  s.seed = Number.isFinite(s.seed) ? Math.floor(s.seed) : 7;
  for (const [k, n] of [['heading', 80], ['message', 400], ['signoff', 40], ['to', 50], ['from', 60], ['customLabel', 60]]) {
    s[k] = typeof s[k] === 'string' ? s[k].replace(/\s+\n/g, '\n').trim().slice(0, n) : '';
  }
  return s;
}
