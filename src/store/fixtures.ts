// Synthetic demo patients. None of these people exist.
import type { Patient } from './types';

export const DEMO_PATIENTS: Patient[] = [
  { id: 'demo-pt-001', synthetic: true, name: 'Sunita Pawar (demo)', age: 54, sex: 'female', village: 'Demo village A', preferredLanguage: 'mr', demoNote: 'Knee pain, gradual onset. Good for the routine knee route.' },
  { id: 'demo-pt-002', synthetic: true, name: 'Ramesh Yadav (demo)', age: 38, sex: 'male', village: 'Demo village B', preferredLanguage: 'hi', demoNote: 'Low back pain after lifting. Try an urgent route (L1 or L5).' },
  { id: 'demo-pt-003', synthetic: true, name: 'Kavita Jadhav (demo)', age: 14, sex: 'female', village: 'Demo village A', preferredLanguage: 'mr', demoNote: 'Under 18: shows the paediatric review requirement.' },
  { id: 'demo-pt-004', synthetic: true, name: 'Farida Shaikh (demo)', age: 63, sex: 'female', village: 'Demo village C', preferredLanguage: 'hi', demoNote: 'Hip and knee pain, not sure which. Shows multiple complaints and pathway switch.' },
  { id: 'demo-pt-005', synthetic: true, name: 'Anil Deshmukh (demo)', age: null, sex: 'male', village: 'Demo village B', preferredLanguage: 'en', demoNote: 'Age not recorded. Neck pain. Shows unknown-age handling.' },
];
