import type { GeoPlace } from '../../../shared/types.ts';

export type Region = 'North America' | 'South America' | 'Europe' | 'Africa' | 'Middle East' | 'Asia' | 'Oceania' | 'Antarctica';
export const REGIONS: Region[] = ['North America', 'South America', 'Europe', 'Africa', 'Middle East', 'Asia', 'Oceania', 'Antarctica'];

export interface Destination {
  name: string;
  sub: string; // "New York, United States"
  lat: number;
  lon: number;
  cc: string;
  region: Region;
  /** Satellite zoom for the card picture: 14 for a neighborhood, lower for mountains and coasts. */
  z: number;
  kind: string;
  featured?: boolean;
}

const d = (name: string, sub: string, lat: number, lon: number, cc: string, region: Region, z = 14, kind = 'quarter', featured = false): Destination =>
  ({ name, sub, lat, lon, cc, region, z, kind, featured });

/** Famous places on every continent. Each one starts the game there, streamed from OpenStreetMap. */
export const DESTINATIONS: Destination[] = [
  // North America
  d('Times Square', 'New York, United States', 40.758, -73.9855, 'us', 'North America', 14, 'square', true),
  d('Brooklyn Bridge', 'New York, United States', 40.7061, -73.9969, 'us', 'North America', 14, 'bridge'),
  d('Central Park', 'New York, United States', 40.7740, -73.9708, 'us', 'North America', 14, 'park'),
  d('Russian Hill', 'San Francisco, United States', 37.8011, -122.4181, 'us', 'North America', 14, 'quarter', true),
  d('Financial District', 'San Francisco, United States', 37.7936, -122.3989, 'us', 'North America'),
  d('Golden Gate Bridge', 'San Francisco, United States', 37.8078, -122.4750, 'us', 'North America', 13, 'bridge'),
  d('Hollywood Sign', 'Los Angeles, United States', 34.1341, -118.3215, 'us', 'North America', 13, 'peak'),
  d('Santa Monica Pier', 'Los Angeles, United States', 34.0094, -118.4973, 'us', 'North America'),
  d('The Strip', 'Las Vegas, United States', 36.1147, -115.1728, 'us', 'North America'),
  d('Grand Canyon', 'Mather Point, Arizona', 36.0617, -112.1077, 'us', 'North America', 12, 'natural', true),
  d('Pike Place Market', 'Seattle, United States', 47.6097, -122.3422, 'us', 'North America'),
  d('The Loop', 'Chicago, United States', 41.8827, -87.6233, 'us', 'North America'),
  d('National Mall', 'Washington, D.C., United States', 38.8895, -77.0353, 'us', 'North America', 13, 'park'),
  d('Back Bay', 'Boston, United States', 42.3503, -71.0810, 'us', 'North America'),
  d('Brickell', 'Miami, United States', 25.7663, -80.1925, 'us', 'North America'),
  d('South Beach', 'Miami Beach, United States', 25.7826, -80.1341, 'us', 'North America'),
  d('Waikiki', 'Honolulu, United States', 21.2766, -157.8278, 'us', 'North America', 13),
  d('CN Tower', 'Toronto, Canada', 43.6426, -79.3871, 'ca', 'North America'),
  d('Niagara Falls', 'Ontario, Canada', 43.0790, -79.0765, 'ca', 'North America', 13, 'natural'),
  d('Whistler', 'British Columbia, Canada', 50.1163, -122.9574, 'ca', 'North America', 12, 'natural'),
  d('Zócalo', 'Mexico City, Mexico', 19.4326, -99.1332, 'mx', 'North America', 14, 'square'),
  d('Old Havana', 'Havana, Cuba', 23.1365, -82.3536, 'cu', 'North America'),
  // South America
  d('Copacabana', 'Rio de Janeiro, Brazil', -22.9711, -43.1822, 'br', 'South America', 13, 'beach', true),
  d('Christ the Redeemer', 'Rio de Janeiro, Brazil', -22.9519, -43.2105, 'br', 'South America', 13, 'peak'),
  d('Machu Picchu', 'Cusco Region, Peru', -13.1631, -72.5450, 'pe', 'South America', 13, 'natural'),
  d('Obelisco', 'Buenos Aires, Argentina', -34.6037, -58.3816, 'ar', 'South America', 14, 'square'),
  d('Old Town', 'Cartagena, Colombia', 10.4236, -75.5503, 'co', 'South America'),
  d('Miraflores', 'Lima, Peru', -12.1211, -77.0297, 'pe', 'South America'),
  d('Torres del Paine', 'Patagonia, Chile', -50.9423, -73.4068, 'cl', 'South America', 11, 'natural'),
  // Europe
  d('The City', 'London, United Kingdom', 51.5134, -0.0890, 'gb', 'Europe', 14, 'quarter', true),
  d('Big Ben', 'Westminster, London', 51.5007, -0.1246, 'gb', 'Europe'),
  d('Old Town', 'Edinburgh, United Kingdom', 55.9486, -3.1999, 'gb', 'Europe'),
  d('Eiffel Tower', 'Paris, France', 48.8584, 2.2945, 'fr', 'Europe', 14, 'landmark', true),
  d('Le Marais', 'Paris, France', 48.8579, 2.3590, 'fr', 'Europe'),
  d('Jordaan', 'Amsterdam, Netherlands', 52.3752, 4.8820, 'nl', 'Europe', 14, 'quarter', true),
  d('Brandenburg Gate', 'Berlin, Germany', 52.5163, 13.3777, 'de', 'Europe'),
  d('Old Town Square', 'Prague, Czechia', 50.0875, 14.4213, 'cz', 'Europe', 14, 'square'),
  d('Sagrada Família', 'Barcelona, Spain', 41.4036, 2.1744, 'es', 'Europe'),
  d('Alfama', 'Lisbon, Portugal', 38.7115, -9.1300, 'pt', 'Europe'),
  d('Colosseum', 'Rome, Italy', 41.8902, 12.4922, 'it', 'Europe', 14, 'landmark'),
  d('St Mark’s Square', 'Venice, Italy', 45.4342, 12.3388, 'it', 'Europe', 14, 'square'),
  d('Zermatt', 'Under the Matterhorn, Switzerland', 46.0207, 7.7491, 'ch', 'Europe', 12, 'natural'),
  d('Oia', 'Santorini, Greece', 36.4618, 25.3753, 'gr', 'Europe', 13),
  d('Old Town', 'Dubrovnik, Croatia', 42.6410, 18.1080, 'hr', 'Europe'),
  d('Hagia Sophia', 'Istanbul, Türkiye', 41.0086, 28.9802, 'tr', 'Europe'),
  d('Hallgrímskirkja', 'Reykjavík, Iceland', 64.1417, -21.9266, 'is', 'Europe'),
  d('Reine', 'Lofoten, Norway', 67.9326, 13.0886, 'no', 'Europe', 12, 'natural'),
  // Africa
  d('Pyramids of Giza', 'Giza, Egypt', 29.9792, 31.1342, 'eg', 'Africa', 13, 'landmark', true),
  d('Jemaa el-Fnaa', 'Marrakesh, Morocco', 31.6258, -7.9891, 'ma', 'Africa', 14, 'square'),
  d('Table Mountain', 'Cape Town, South Africa', -33.9628, 18.4098, 'za', 'Africa', 12, 'natural'),
  d('V&A Waterfront', 'Cape Town, South Africa', -33.9036, 18.4207, 'za', 'Africa'),
  d('Victoria Falls', 'Zambia & Zimbabwe', -17.9243, 25.8572, 'zw', 'Africa', 13, 'natural'),
  d('Stone Town', 'Zanzibar, Tanzania', -6.1630, 39.1890, 'tz', 'Africa'),
  d('Kilimanjaro', 'Kilimanjaro Region, Tanzania', -3.0674, 37.3556, 'tz', 'Africa', 11, 'peak'),
  d('Central Business District', 'Nairobi, Kenya', -1.2864, 36.8172, 'ke', 'Africa'),
  // Middle East
  d('Burj Khalifa', 'Downtown Dubai, UAE', 25.1972, 55.2744, 'ae', 'Middle East', 14, 'landmark', true),
  d('Dubai Marina', 'Dubai, UAE', 25.0805, 55.1403, 'ae', 'Middle East'),
  d('Petra', 'Ma’an, Jordan', 30.3285, 35.4444, 'jo', 'Middle East', 13, 'landmark'),
  d('Old City', 'Jerusalem', 31.7767, 35.2345, 'il', 'Middle East'),
  // Asia
  d('Shibuya Crossing', 'Tokyo, Japan', 35.6595, 139.7005, 'jp', 'Asia', 14, 'square', true),
  d('Gion', 'Kyoto, Japan', 35.0037, 135.7788, 'jp', 'Asia'),
  d('Mount Fuji', 'Shizuoka, Japan', 35.3606, 138.7274, 'jp', 'Asia', 11, 'peak'),
  d('Gangnam', 'Seoul, South Korea', 37.4979, 127.0276, 'kr', 'Asia'),
  d('The Bund', 'Shanghai, China', 31.2400, 121.4900, 'cn', 'Asia'),
  d('Central', 'Hong Kong', 22.2820, 114.1588, 'hk', 'Asia', 14, 'quarter', true),
  d('Taipei 101', 'Taipei, Taiwan', 25.0340, 121.5645, 'tw', 'Asia'),
  d('Marina Bay', 'Singapore', 1.2834, 103.8607, 'sg', 'Asia', 14, 'quarter', true),
  d('Grand Palace', 'Bangkok, Thailand', 13.7500, 100.4913, 'th', 'Asia'),
  d('Angkor Wat', 'Siem Reap, Cambodia', 13.4125, 103.8670, 'kh', 'Asia', 13, 'landmark'),
  d('Ha Long Bay', 'Quảng Ninh, Vietnam', 20.9101, 107.1839, 'vn', 'Asia', 12, 'natural'),
  d('Ubud', 'Bali, Indonesia', -8.5069, 115.2625, 'id', 'Asia', 13),
  d('Taj Mahal', 'Agra, India', 27.1751, 78.0421, 'in', 'Asia', 14, 'landmark'),
  d('Marine Drive', 'Mumbai, India', 18.9440, 72.8230, 'in', 'Asia'),
  d('Everest Base Camp', 'Khumbu, Nepal', 28.0026, 86.8528, 'np', 'Asia', 12, 'peak'),
  // Oceania
  d('Sydney Opera House', 'Sydney, Australia', -33.8568, 151.2153, 'au', 'Oceania', 14, 'landmark', true),
  d('Bondi Beach', 'Sydney, Australia', -33.8908, 151.2743, 'au', 'Oceania', 14, 'beach'),
  d('Melbourne CBD', 'Melbourne, Australia', -37.8136, 144.9631, 'au', 'Oceania'),
  d('Uluru', 'Northern Territory, Australia', -25.3444, 131.0369, 'au', 'Oceania', 12, 'natural'),
  d('Queenstown', 'Otago, New Zealand', -45.0312, 168.6626, 'nz', 'Oceania', 12),
  d('Bora Bora', 'French Polynesia', -16.5004, -151.7415, 'pf', 'Oceania', 12, 'natural'),
  // Antarctica
  d('McMurdo Station', 'Ross Island, Antarctica', -77.8463, 166.6681, 'aq', 'Antarctica', 12, 'natural'),
];

export const toGeoPlace = (p: Destination): GeoPlace =>
  ({ name: p.name, label: `${p.name}, ${p.sub}`, lat: p.lat, lon: p.lon, countryCode: p.cc, kind: p.kind });
