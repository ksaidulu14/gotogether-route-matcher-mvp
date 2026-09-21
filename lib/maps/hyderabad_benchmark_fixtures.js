/**
 * GoTogether Location Accuracy Benchmark - 100+ Hyderabad Test Fixtures
 */

const HYDERABAD_BENCHMARK_FIXTURES = [
  // ==========================================
  // 1. LOCALITIES (30 Test Cases)
  // ==========================================
  { id: 'LOC_01', category: 'locality_search', query: 'Uppal', reference: 'Uppal, Hyderabad' },
  { id: 'LOC_02', category: 'locality_search', query: 'Nagole', reference: 'Nagole, Hyderabad' },
  { id: 'LOC_03', category: 'locality_search', query: 'Ghatkesar', reference: 'Ghatkesar, Medchal-Malkajgiri' },
  { id: 'LOC_04', category: 'locality_search', query: 'Tarnaka', reference: 'Tarnaka, Hyderabad' },
  { id: 'LOC_05', category: 'locality_search', query: 'Boduppal', reference: 'Boduppal, Medipally' },
  { id: 'LOC_06', category: 'locality_search', query: 'Peerzadiguda', reference: 'Peerzadiguda, Hyderabad' },
  { id: 'LOC_07', category: 'locality_search', query: 'Rampally', reference: 'Rampally, Medchal-Malkajgiri' },
  { id: 'LOC_08', category: 'locality_search', query: 'Kukatpally', reference: 'Kukatpally, Hyderabad' },
  { id: 'LOC_09', category: 'locality_search', query: 'Madhapur', reference: 'Madhapur, Hyderabad' },
  { id: 'LOC_10', category: 'locality_search', query: 'Gachibowli', reference: 'Gachibowli, Hyderabad' },
  { id: 'LOC_11', category: 'locality_search', query: 'Kondapur', reference: 'Kondapur, Hyderabad' },
  { id: 'LOC_12', category: 'locality_search', query: 'Miyapur', reference: 'Miyapur, Hyderabad' },
  { id: 'LOC_13', category: 'locality_search', query: 'Banjara Hills', reference: 'Banjara Hills, Hyderabad' },
  { id: 'LOC_14', category: 'locality_search', query: 'Jubilee Hills', reference: 'Jubilee Hills, Hyderabad' },
  { id: 'LOC_15', category: 'locality_search', query: 'Dilsukhnagar', reference: 'Dilsukhnagar, Hyderabad' },
  { id: 'LOC_16', category: 'locality_search', query: 'Ameerpet', reference: 'Ameerpet, Hyderabad' },
  { id: 'LOC_17', category: 'locality_search', query: 'Begumpet', reference: 'Begumpet, Hyderabad' },
  { id: 'LOC_18', category: 'locality_search', query: 'Secunderabad', reference: 'Secunderabad, Telangana' },
  { id: 'LOC_19', category: 'locality_search', query: 'Mehdipatnam', reference: 'Mehdipatnam, Hyderabad' },
  { id: 'LOC_20', category: 'locality_search', query: 'Koti Hyderabad', reference: 'Koti, Hyderabad' },
  { id: 'LOC_21', category: 'locality_search', query: 'Himayatnagar', reference: 'Himayatnagar, Hyderabad' },
  { id: 'LOC_22', category: 'locality_search', query: 'Malakpet', reference: 'Malakpet, Hyderabad' },
  { id: 'LOC_23', category: 'locality_search', query: 'Saroornagar', reference: 'Saroornagar, Hyderabad' },
  { id: 'LOC_24', category: 'locality_search', query: 'LB Nagar', reference: 'LB Nagar, Hyderabad' },
  { id: 'LOC_25', category: 'locality_search', query: 'Hayathnagar', reference: 'Hayathnagar, Hyderabad' },
  { id: 'LOC_26', category: 'locality_search', query: 'Chandanagar', reference: 'Chandanagar, Serilingampalle' },
  { id: 'LOC_27', category: 'locality_search', query: 'Lingampally', reference: 'Lingampally, Serilingampalle' },
  { id: 'LOC_28', category: 'locality_search', query: 'Manikonda', reference: 'Manikonda, Hyderabad' },
  { id: 'LOC_29', category: 'locality_search', query: 'Hafeezpet', reference: 'Hafeezpet, Hyderabad' },
  { id: 'LOC_30', category: 'locality_search', query: 'Attapur', reference: 'Attapur, Hyderabad' },

  // ==========================================
  // 2. LANDMARKS (20 Test Cases)
  // ==========================================
  { id: 'LND_01', category: 'landmark_search', query: 'Charminar Hyderabad', reference: 'Charminar' },
  { id: 'LND_02', category: 'landmark_search', query: 'Golconda Fort', reference: 'Golconda Fort' },
  { id: 'LND_03', category: 'landmark_search', query: 'Hussain Sagar Hyderabad', reference: 'Hussain Sagar' },
  { id: 'LND_04', category: 'landmark_search', query: 'Mindspace IT Park Madhapur', reference: 'Mindspace IT Park' },
  { id: 'LND_05', category: 'landmark_search', query: 'Inorbit Mall Hitec City', reference: 'Inorbit Mall' },
  { id: 'LND_06', category: 'landmark_search', query: 'Salar Jung Museum', reference: 'Salar Jung Museum' },
  { id: 'LND_07', category: 'landmark_search', query: 'Birla Mandir Hyderabad', reference: 'Birla Mandir' },
  { id: 'LND_08', category: 'landmark_search', query: 'Chilkur Balaji Temple', reference: 'Chilkur Balaji Temple' },
  { id: 'LND_09', category: 'landmark_search', query: 'Cyber Towers Hitec City', reference: 'Cyber Towers' },
  { id: 'LND_10', category: 'landmark_search', query: 'Gachibowli Stadium', reference: 'Gachibowli Stadium' },
  { id: 'LND_11', category: 'landmark_search', query: 'T Hub Phase 2 Raidurg', reference: 'T-Hub Phase 2' },
  { id: 'LND_12', category: 'landmark_search', query: 'Secunderabad Railway Station', reference: 'Secunderabad Junction' },
  { id: 'LND_13', category: 'landmark_search', query: 'Kacheguda Railway Station', reference: 'Kacheguda Station' },
  { id: 'LND_14', category: 'landmark_search', query: 'Hyderabad Deccan Station Nampally', reference: 'Nampally Station' },
  { id: 'LND_15', category: 'landmark_search', query: 'Rajiv Gandhi International Airport Shamshabad', reference: 'RGIA Airport' },
  { id: 'LND_16', category: 'landmark_search', query: 'DLF Cyber City Gachibowli', reference: 'DLF Cyber City' },
  { id: 'LND_17', category: 'landmark_search', query: 'Botanical Garden Kondapur', reference: 'Kotla Vijayabhaskara Reddy Botanical Garden' },
  { id: 'LND_18', category: 'landmark_search', query: 'KBR National Park Jubilee Hills', reference: 'KBR Park' },
  { id: 'LND_19', category: 'landmark_search', query: 'Shilparamam Hitec City', reference: 'Shilparamam Arts Crafts Village' },
  { id: 'LND_20', category: 'landmark_search', query: 'Lumbini Park Tank Bund', reference: 'Lumbini Park' },

  // ==========================================
  // 3. MISSPELLINGS & TYPOS (20 Test Cases)
  // ==========================================
  { id: 'MSP_01', category: 'misspelling_search', query: 'Upaal Hydrabad', reference: 'Uppal, Hyderabad' },
  { id: 'MSP_02', category: 'misspelling_search', query: 'Tarnakaa Telangana', reference: 'Tarnaka' },
  { id: 'MSP_03', category: 'misspelling_search', query: 'Boduupal Hyd', reference: 'Boduppal' },
  { id: 'MSP_04', category: 'misspelling_search', query: 'Begumpettt Secunderabad', reference: 'Begumpet' },
  { id: 'MSP_05', category: 'misspelling_search', query: 'LBNagar Hyd', reference: 'LB Nagar' },
  { id: 'MSP_06', category: 'misspelling_search', query: 'Mehdipatnammm Hyderabad', reference: 'Mehdipatnam' },
  { id: 'MSP_07', category: 'misspelling_search', query: 'Kukatpalli Hydrabad', reference: 'Kukatpally' },
  { id: 'MSP_08', category: 'misspelling_search', query: 'Gachibowlee Hitech', reference: 'Gachibowli' },
  { id: 'MSP_09', category: 'misspelling_search', query: 'Kondapoor Hitech City', reference: 'Kondapur' },
  { id: 'MSP_10', category: 'misspelling_search', query: 'Ameerpeet Hyderabad', reference: 'Ameerpet' },
  { id: 'MSP_11', category: 'misspelling_search', query: 'Dilshuknagar Hyd', reference: 'Dilsukhnagar' },
  { id: 'MSP_12', category: 'misspelling_search', query: 'Jubilee Hils Hyd', reference: 'Jubilee Hills' },
  { id: 'MSP_13', category: 'misspelling_search', query: 'Banjarahills Road', reference: 'Banjara Hills' },
  { id: 'MSP_14', category: 'misspelling_search', query: 'Secunderbad Junction', reference: 'Secunderabad' },
  { id: 'MSP_15', category: 'misspelling_search', query: 'Ghatkeser Medchal', reference: 'Ghatkesar' },
  { id: 'MSP_16', category: 'misspelling_search', query: 'Peerzadigudaa Medipally', reference: 'Peerzadiguda' },
  { id: 'MSP_17', category: 'misspelling_search', query: 'Rampalli Medchal', reference: 'Rampally' },
  { id: 'MSP_18', category: 'misspelling_search', query: 'Nagol Circle', reference: 'Nagole' },
  { id: 'MSP_19', category: 'misspelling_search', query: 'Chanda Nagar Hydrabad', reference: 'Chandanagar' },
  { id: 'MSP_20', category: 'misspelling_search', query: 'Shamshbad Airport', reference: 'Shamshabad' },

  // ==========================================
  // 4. PIN CODES (15 Test Cases)
  // ==========================================
  { id: 'PIN_01', category: 'pincode_search', query: '500039', reference: '500039 (Uppal)' },
  { id: 'PIN_02', category: 'pincode_search', query: '500007', reference: '500007 (Tarnaka)' },
  { id: 'PIN_03', category: 'pincode_search', query: '500081', reference: '500081 (Madhapur)' },
  { id: 'PIN_04', category: 'pincode_search', query: '500032', reference: '500032 (Gachibowli)' },
  { id: 'PIN_05', category: 'pincode_search', query: '500016', reference: '500016 (Begumpet)' },
  { id: 'PIN_06', category: 'pincode_search', query: '500003', reference: '500003 (Secunderabad)' },
  { id: 'PIN_07', category: 'pincode_search', query: '500062', reference: '500062 (ECIL/Kushaiguda)' },
  { id: 'PIN_08', category: 'pincode_search', query: '500072', reference: '500072 (Kukatpally)' },
  { id: 'PIN_09', category: 'pincode_search', query: '500035', reference: '500035 (Dilsukhnagar)' },
  { id: 'PIN_10', category: 'pincode_search', query: '500084', reference: '500084 (Kondapur)' },
  { id: 'PIN_11', category: 'pincode_search', query: '500034', reference: '500034 (Banjara Hills)' },
  { id: 'PIN_12', category: 'pincode_search', query: '500033', reference: '500033 (Jubilee Hills)' },
  { id: 'PIN_13', category: 'pincode_search', query: '500001', reference: '500001 (Koti/Abids)' },
  { id: 'PIN_14', category: 'pincode_search', query: '500028', reference: '500028 (Mehdipatnam)' },
  { id: 'PIN_15', category: 'pincode_search', query: '500068', reference: '500068 (Nagole)' },

  // ==========================================
  // 5. ROADS & HIGHWAYS (15 Test Cases)
  // ==========================================
  { id: 'RD_01', category: 'road_search', query: 'Inner Ring Road Hyderabad', reference: 'Inner Ring Road' },
  { id: 'RD_02', category: 'road_search', query: 'Outer Ring Road Hyderabad', reference: 'Outer Ring Road' },
  { id: 'RD_03', category: 'road_search', query: 'PVNR Expressway Hyderabad', reference: 'PVNR Expressway' },
  { id: 'RD_04', category: 'road_search', query: 'NH 65 Hyderabad Vijayawada Highway', reference: 'NH 65' },
  { id: 'RD_05', category: 'road_search', query: 'Warangal Highway Uppal Hyderabad', reference: 'NH 163 Warangal Highway' },
  { id: 'RD_06', category: 'road_search', query: 'Gachibowli Miyapur Road', reference: 'Gachibowli - Miyapur Road' },
  { id: 'RD_07', category: 'road_search', query: 'Banjara Hills Road No 1', reference: 'Road No 1 Banjara Hills' },
  { id: 'RD_08', category: 'road_search', query: 'Jubilee Hills Road No 36', reference: 'Road No 36 Jubilee Hills' },
  { id: 'RD_09', category: 'road_search', query: '100 Feet Road Madhapur', reference: '100 Feet Road Madhapur' },
  { id: 'RD_10', category: 'road_search', query: 'Raj Bhavan Road Somajiguda', reference: 'Raj Bhavan Road' },
  { id: 'RD_11', category: 'road_search', query: 'Sardar Patel Road Secunderabad', reference: 'SP Road' },
  { id: 'RD_12', category: 'road_search', query: 'MG Road Secunderabad', reference: 'Mahatma Gandhi Road' },
  { id: 'RD_13', category: 'road_search', query: 'Abids Main Road Hyderabad', reference: 'Abids Road' },
  { id: 'RD_14', category: 'road_search', query: 'Tarnaka ECIL Main Road', reference: 'Tarnaka - ECIL Road' },
  { id: 'RD_15', category: 'road_search', query: 'Uppal Ramanthapur Main Road', reference: 'Uppal Ramanthapur Road' },

  // ==========================================
  // 6. ROUTE TESTS (15 Test Cases)
  // ==========================================
  { id: 'RT_01', category: 'route_test', origin: { lat: 17.3984, lon: 78.5583 }, destination: { lat: 17.4528, lon: 78.6835 }, reference: 'Uppal -> Ghatkesar (~15-17km)' },
  { id: 'RT_02', category: 'route_test', origin: { lat: 17.3750, lon: 78.5600 }, destination: { lat: 17.4528, lon: 78.6835 }, reference: 'Nagole -> Ghatkesar (~15-18km)' },
  { id: 'RT_03', category: 'route_test', origin: { lat: 17.3984, lon: 78.5583 }, destination: { lat: 17.4789, lon: 78.6124 }, reference: 'Uppal -> Rampally (~10-12km)' },
  { id: 'RT_04', category: 'route_test', origin: { lat: 17.4250, lon: 78.5350 }, destination: { lat: 17.4650, lon: 78.5680 }, reference: 'Tarnaka -> ECIL (~7-9km)' },
  { id: 'RT_05', category: 'route_test', origin: { lat: 17.4850, lon: 78.4100 }, destination: { lat: 17.4480, lon: 78.3800 }, reference: 'Kukatpally -> Hitec City (~8-10km)' },
  { id: 'RT_06', category: 'route_test', origin: { lat: 17.4400, lon: 78.3480 }, destination: { lat: 17.2400, lon: 78.4290 }, reference: 'Gachibowli -> RGIA Airport (~30-35km)' },
  { id: 'RT_07', category: 'route_test', origin: { lat: 17.4400, lon: 78.5000 }, destination: { lat: 17.4440, lon: 78.4680 }, reference: 'Secunderabad -> Begumpet (~5-6km)' },
  { id: 'RT_08', category: 'route_test', origin: { lat: 17.3950, lon: 78.4400 }, destination: { lat: 17.4150, lon: 78.4480 }, reference: 'Mehdipatnam -> Banjara Hills (~4-6km)' },
  { id: 'RT_09', category: 'route_test', origin: { lat: 17.3650, lon: 78.5500 }, destination: { lat: 17.3680, lon: 78.5250 }, reference: 'LB Nagar -> Dilsukhnagar (~3-4km)' },
  { id: 'RT_10', category: 'route_test', origin: { lat: 17.4370, lon: 78.4480 }, destination: { lat: 17.4300, lon: 78.4080 }, reference: 'Ameerpet -> Jubilee Hills (~5-7km)' },
  { id: 'RT_11', category: 'route_test', origin: { lat: 17.4620, lon: 78.3680 }, destination: { lat: 17.4400, lon: 78.3480 }, reference: 'Kondapur -> Gachibowli (~4-5km)' },
  { id: 'RT_12', category: 'route_test', origin: { lat: 17.4950, lon: 78.3650 }, destination: { lat: 17.4980, lon: 78.3280 }, reference: 'Miyapur -> Chandanagar (~4-6km)' },
  { id: 'RT_13', category: 'route_test', origin: { lat: 17.4120, lon: 78.5780 }, destination: { lat: 17.3984, lon: 78.5583 }, reference: 'Boduppal -> Uppal Ring Road (~3-4km)' },
  { id: 'RT_14', category: 'route_test', origin: { lat: 17.4789, lon: 78.6124 }, destination: { lat: 17.4080, lon: 78.5720 }, reference: 'Rampally -> Peerzadiguda (~8-10km)' },
  { id: 'RT_15', category: 'route_test', origin: { lat: 17.3300, lon: 78.6000 }, destination: { lat: 17.3650, lon: 78.5500 }, reference: 'Hayathnagar -> LB Nagar (~7-9km)' }
];

module.exports = HYDERABAD_BENCHMARK_FIXTURES;
