// Europe and the Middle East: the hand-built landmarks (pure data, the chunk worker reads it too).
// Positions are the real ones (each model is anchored on the map's own footprints when it hands
// them over); heights from the buildings' published figures:
//   Tower Bridge 65 m towers, 61 m bascule span, 82 m side spans (towerbridge.org.uk); the Shard 310 m;
//   30 St Mary Axe 180 m; St Paul's 111 m to the cross, west towers 67 m; London Eye 135 m, 120 m wheel;
//   White Tower 27 m; Nelson's Column 51.6 m; Bernini's colonnade four columns deep; Sacré-Cœur 83 m dome, 91 m campanile; Dôme des Invalides 107 m; Panthéon 83 m;
//   St Peter's 136.6 m; the Pantheon in Rome 43.3 m; Sagrada Família 172.5 m (Tower of Jesus Christ,
//   cross set February 2026); Brandenburg Gate 26 m; Fernsehturm 368 m; Hagia Sophia 55.6 m dome;
//   Sultan Ahmed Mosque 43 m dome, six minarets; Burj Al Arab 321 m; Khufu 138.5 m (230.3 m base),
//   Khafre 136.4 m (215.3 m), Menkaure 61 m (102.2 m); the Great Sphinx 73 m long, 20 m tall.
import type { Landmark } from './catalog.ts';

export const EU_LANDMARKS: Landmark[] = [
  // ------------------------------------------------------------------ London
  { id: 'towerbridge', name: 'Tower Bridge', addr: 'Tower Bridge Rd, London', lat: 51.505517, lon: -0.075359, zone: { w: 64, d: 100 }, bearing: 26, model: 'towerBridge', height: 65 },
  { id: 'shard', name: 'The Shard', addr: '32 London Bridge St, London', lat: 51.504475, lon: -0.0865, zone: { r: 30 }, claimMinH: 100, bearing: 0, model: 'shard', height: 310 },
  { id: 'gherkin', name: '30 St Mary Axe (The Gherkin)', addr: '30 St Mary Axe, London', lat: 51.514475, lon: -0.080332, zone: { r: 22 }, claimMinH: 60, bearing: 0, model: 'gherkin', height: 180 },
  { id: 'stpauls', name: "St Paul's Cathedral", addr: "St Paul's Churchyard, London", lat: 51.513787, lon: -0.098314, zone: { r: 12 }, claimMinH: 38, bearing: 0, model: 'stPaulsDome', height: 111 },
  { id: 'stpaulsW', name: "St Paul's Cathedral", addr: "St Paul's Churchyard, London", lat: 51.513717, lon: -0.099423, zone: { w: 22, d: 58 }, claimMinH: 36, bearing: 354, model: 'stPaulsTowers', height: 67 },
  { id: 'londoneye', name: 'London Eye', addr: 'South Bank, London', lat: 51.5033, lon: -0.1196, zone: { r: 36 }, bearing: 8, model: 'londonEye', height: 135 },
  { id: 'nelson', name: "Nelson's Column", addr: 'Trafalgar Square, London', lat: 51.507741, lon: -0.127968, zone: { r: 9 }, bearing: 0, model: 'nelson', height: 51.6 },
  { id: 'whitetower', name: 'Tower of London (White Tower)', addr: 'Tower Hill, London', lat: 51.50806, lon: -0.076, zone: { r: 27 }, bearing: 4, model: 'whiteTower', height: 36 },
  // ------------------------------------------------------------------ Paris
  { id: 'sacrecoeur', name: 'Sacré-Cœur', addr: 'Montmartre, Paris', lat: 48.88675, lon: 2.34303, zone: { r: 60 }, bearing: 0, model: 'sacreCoeur', height: 91 },
  { id: 'invalides', name: 'Dôme des Invalides', addr: 'Place Vauban, Paris', lat: 48.85503, lon: 2.31254, zone: { r: 40 }, bearing: 0, model: 'invalides', height: 107 },
  { id: 'pantheonfr', name: 'Panthéon', addr: 'Place du Panthéon, Paris', lat: 48.846222, lon: 2.346, zone: { r: 58 }, bearing: 98, model: 'pantheonParis', height: 83 },
  // ------------------------------------------------------------------ Rome
  { id: 'stpeters', name: "St. Peter's Basilica", addr: 'Vatican City', lat: 41.9022, lon: 12.4535, zone: { w: 232, d: 160 }, bearing: 0, model: 'stPeters', height: 137 },
  { id: 'piazzasp', name: "St. Peter's Square", addr: 'Vatican City', lat: 41.90224, lon: 12.45726, zone: { r: 4 }, bearing: 0, model: 'piazzaSanPietro', height: 34 },
  { id: 'pantheonrm', name: 'Pantheon', addr: 'Piazza della Rotonda, Rome', lat: 41.898614, lon: 12.476869, zone: { r: 31 }, bearing: 0, model: 'pantheonRome', height: 44 },
  // ------------------------------------------------------------------ Barcelona
  { id: 'sagrada', name: 'Sagrada Família', addr: 'Carrer de Mallorca 401, Barcelona', lat: 41.403629, lon: 2.174356, zone: { r: 70 }, bearing: 315, model: 'sagrada', height: 172.5 },
  // ------------------------------------------------------------------ Berlin
  { id: 'brandenburg', name: 'Brandenburg Gate', addr: 'Pariser Platz, Berlin', lat: 52.516275, lon: 13.377704, zone: { r: 22 }, bearing: 0, model: 'brandenburg', height: 26 },
  { id: 'fernsehturm', name: 'Berlin TV Tower (Fernsehturm)', addr: 'Alexanderplatz, Berlin', lat: 52.520815, lon: 13.409419, zone: { r: 10 }, claimMinH: 30, bearing: 0, model: 'fernsehturm', height: 368 },
  // ------------------------------------------------------------------ Istanbul
  { id: 'hagiasophia', name: 'Hagia Sophia', addr: 'Sultanahmet, Istanbul', lat: 41.00852, lon: 28.98012, zone: { r: 64 }, bearing: 23, model: 'hagiaSophia', height: 72 },
  { id: 'bluemosque', name: 'Sultan Ahmed Mosque (Blue Mosque)', addr: 'Sultanahmet, Istanbul', lat: 41.0054, lon: 28.97685, zone: { r: 84 }, bearing: 0, model: 'blueMosque', height: 64 },
  // ------------------------------------------------------------------ Dubai
  { id: 'burjalarab', name: 'Burj Al Arab', addr: 'Jumeirah, Dubai', lat: 25.141175, lon: 55.185536, zone: { r: 40 }, claimMinH: 60, bearing: 0, model: 'burjAlArab', height: 321 },
  // ------------------------------------------------------------------ Giza
  { id: 'khufu', name: 'Great Pyramid of Giza (Khufu)', addr: 'Giza Plateau, Egypt', lat: 29.979373, lon: 31.13422, zone: { r: 40 }, claimMinH: 60, bearing: 0, model: 'pyramidKhufu', height: 138.5 },
  { id: 'khafre', name: 'Pyramid of Khafre', addr: 'Giza Plateau, Egypt', lat: 29.976111, lon: 31.130833, zone: { r: 40 }, claimMinH: 40, bearing: 0, model: 'pyramidKhafre', height: 136.4 },
  { id: 'menkaure', name: 'Pyramid of Menkaure', addr: 'Giza Plateau, Egypt', lat: 29.9725, lon: 31.128333, zone: { r: 30 }, claimMinH: 20, bearing: 0, model: 'pyramidMenkaure', height: 61 },
  { id: 'sphinx', name: 'Great Sphinx of Giza', addr: 'Giza Plateau, Egypt', lat: 29.975284, lon: 31.137496, zone: { r: 22 }, bearing: 0, model: 'sphinx', height: 20 },
];
