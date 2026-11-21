/**
 * Growth catalogue: the industries Ayava targets, the services it sells and the
 * extra checks each industry gets. This file is the *seed source* for the
 * `lead_industries` table (prisma/seed/reference.ts); at runtime the database
 * copy is used, so an admin can change terms or switch an industry off.
 */

/** Ayava's 15 services (ayavacreatives.com/services). */
export const AYAVA_SERVICES = {
  smm: 'Social Media Marketing',
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  seo: 'SEO',
  website: 'Website Design',
  branding: 'Branding',
  content: 'Content Marketing',
  influencer: 'Influencer Marketing',
  email_crm: 'Email/CRM Marketing',
  aso: 'App Store Marketing/ASO',
  video: 'Video & Motion Production',
  reputation: 'PR/Reputation Management',
  ecommerce: 'E-commerce Growth',
  analytics_cro: 'Analytics/CRO',
  ai: 'AI Marketing',
} as const
export type AyavaService = keyof typeof AYAVA_SERVICES

/**
 * Industry-specific checks (in addition to the general website audit):
 *   booking    an online booking / appointment link or widget
 *   ordering   an online food-ordering link (Zomato, Swiggy, own ordering)
 *   direct_booking  a hotel or tour that takes bookings on its own site, not only through OTAs
 *   store      an online store (cart / checkout)
 *   portfolio  a gallery / portfolio / projects page
 *   lead_form  an enquiry or quote form
 *   menu       a readable menu (not only a PDF)
 */
export const INDUSTRY_CHECKS = ['booking', 'ordering', 'direct_booking', 'store', 'portfolio', 'lead_form', 'menu'] as const
export type IndustryCheck = (typeof INDUSTRY_CHECKS)[number]

export interface IndustryDefinition {
  key: string
  name: string
  /** Google Places text-search terms ("<term> in <city>"). */
  terms: string[]
  /** OpenStreetMap tags ("key=value") for the free backup source. */
  osmTags: string[]
  checks: IndustryCheck[]
  /** 1 = highest priority (adds the most to the fit score), 3 = lowest. */
  priority: 1 | 2 | 3
}

export const INDUSTRIES: IndustryDefinition[] = [
  { key: 'real_estate', name: 'Real estate', terms: ['real estate developer', 'real estate agent'], osmTags: ['office=estate_agent'], checks: ['lead_form', 'portfolio'], priority: 1 },
  { key: 'd2c_ecommerce', name: 'D2C / e-commerce brands', terms: ['online store brand', 'handicraft store'], osmTags: ['shop=gift', 'shop=craft'], checks: ['store'], priority: 2 },
  { key: 'healthcare', name: 'Healthcare (clinics, hospitals)', terms: ['clinic', 'hospital'], osmTags: ['amenity=clinic', 'amenity=hospital', 'amenity=doctors'], checks: ['booking'], priority: 1 },
  { key: 'hospitality_travel', name: 'Hospitality & travel', terms: ['hotel', 'homestay', 'tour operator'], osmTags: ['tourism=hotel', 'tourism=guest_house', 'shop=travel_agency'], checks: ['direct_booking'], priority: 1 },
  { key: 'fintech_finance', name: 'FinTech / financial services', terms: ['financial advisor', 'loan agency', 'insurance agency'], osmTags: ['office=financial', 'office=insurance', 'office=financial_advisor'], checks: ['lead_form'], priority: 2 },
  { key: 'fashion_luxury', name: 'Fashion & luxury', terms: ['fashion boutique', 'designer studio'], osmTags: ['shop=boutique', 'shop=clothes'], checks: ['store'], priority: 2 },
  { key: 'edtech', name: 'EdTech', terms: ['edtech company', 'online courses institute'], osmTags: ['office=educational_institution'], checks: ['lead_form'], priority: 2 },
  { key: 'saas_tech', name: 'SaaS / tech companies', terms: ['software company', 'IT company'], osmTags: ['office=it', 'office=company'], checks: ['lead_form'], priority: 3 },
  { key: 'automotive', name: 'Automotive (dealers, service centres)', terms: ['car dealer', 'car service centre', 'bike showroom'], osmTags: ['shop=car', 'shop=car_repair', 'shop=motorcycle'], checks: ['lead_form', 'booking'], priority: 2 },
  { key: 'fnb_qsr', name: 'F&B / QSR (restaurants, cafés, cloud kitchens)', terms: ['restaurant', 'cafe', 'cloud kitchen'], osmTags: ['amenity=restaurant', 'amenity=cafe', 'amenity=fast_food'], checks: ['ordering', 'menu'], priority: 1 },
  { key: 'dental', name: 'Dental clinics', terms: ['dental clinic', 'dentist'], osmTags: ['amenity=dentist', 'healthcare=dentist'], checks: ['booking'], priority: 1 },
  { key: 'skin_hair', name: 'Skin, hair & cosmetic clinics', terms: ['skin clinic', 'hair transplant clinic', 'cosmetic clinic'], osmTags: ['healthcare=clinic'], checks: ['booking'], priority: 1 },
  { key: 'salon_spa', name: 'Salons, spas & beauty studios', terms: ['beauty salon', 'spa', 'unisex salon'], osmTags: ['shop=beauty', 'shop=hairdresser', 'leisure=spa'], checks: ['booking'], priority: 2 },
  { key: 'fitness', name: 'Gyms, fitness & yoga studios', terms: ['gym', 'yoga studio', 'fitness centre'], osmTags: ['leisure=fitness_centre', 'sport=yoga'], checks: ['lead_form'], priority: 2 },
  { key: 'coaching', name: 'Coaching institutes', terms: ['coaching institute', 'IELTS coaching', 'NEET JEE coaching'], osmTags: ['amenity=prep_school', 'amenity=training'], checks: ['lead_form'], priority: 1 },
  { key: 'schools_colleges', name: 'Schools, colleges & universities', terms: ['school', 'college'], osmTags: ['amenity=school', 'amenity=college', 'amenity=university'], checks: ['lead_form'], priority: 1 },
  { key: 'interior_architect', name: 'Interior designers & architects', terms: ['interior designer', 'architect'], osmTags: ['office=architect', 'craft=interior_decorator'], checks: ['portfolio', 'lead_form'], priority: 1 },
  { key: 'furniture_decor', name: 'Furniture & home décor stores', terms: ['furniture store', 'home decor store'], osmTags: ['shop=furniture', 'shop=interior_decoration'], checks: ['store'], priority: 2 },
  { key: 'jewellery', name: 'Jewellery stores', terms: ['jewellery store', 'jewellers'], osmTags: ['shop=jewelry'], checks: ['store'], priority: 2 },
  { key: 'wedding', name: 'Wedding services (venues, planners, photographers)', terms: ['wedding venue', 'wedding planner', 'wedding photographer'], osmTags: ['amenity=events_venue', 'craft=photographer'], checks: ['portfolio', 'lead_form'], priority: 2 },
  { key: 'legal_ca', name: 'Law firms & CA / tax consultants', terms: ['chartered accountant', 'tax consultant', 'law firm'], osmTags: ['office=lawyer', 'office=accountant', 'office=tax_advisor'], checks: ['lead_form'], priority: 2 },
  { key: 'pharmacy_lab', name: 'Pharmacies & diagnostic labs', terms: ['diagnostic centre', 'pathology lab', 'pharmacy'], osmTags: ['amenity=pharmacy', 'healthcare=laboratory'], checks: ['booking'], priority: 3 },
  { key: 'pet', name: 'Pet clinics, groomers & pet stores', terms: ['veterinary clinic', 'pet shop', 'pet grooming'], osmTags: ['amenity=veterinary', 'shop=pet', 'shop=pet_grooming'], checks: ['booking'], priority: 3 },
  { key: 'manufacturing_b2b', name: 'Manufacturers & exporters (B2B)', terms: ['manufacturer', 'exporter'], osmTags: ['man_made=works', 'industrial=factory'], checks: ['lead_form', 'portfolio'], priority: 2 },
  { key: 'logistics_movers', name: 'Logistics & packers-movers', terms: ['packers and movers', 'logistics company'], osmTags: ['office=moving_company', 'office=logistics'], checks: ['lead_form'], priority: 3 },
  { key: 'solar', name: 'Solar & renewable energy installers', terms: ['solar panel installer', 'solar company'], osmTags: ['craft=solar_installer'], checks: ['lead_form'], priority: 2 },
  { key: 'events', name: 'Event management companies', terms: ['event management company', 'event planner'], osmTags: ['office=event_management'], checks: ['portfolio', 'lead_form'], priority: 2 },
  { key: 'study_abroad', name: 'Study-abroad & immigration consultants', terms: ['study abroad consultant', 'immigration consultant'], osmTags: ['office=consulting'], checks: ['lead_form'], priority: 1 },
  { key: 'adventure_resorts', name: 'Adventure tourism & resorts', terms: ['camping resort', 'river rafting', 'resort'], osmTags: ['tourism=camp_site', 'leisure=resort', 'tourism=chalet'], checks: ['direct_booking', 'booking'], priority: 1 },
  { key: 'local_retail', name: 'Local retail & supermarkets', terms: ['supermarket', 'departmental store'], osmTags: ['shop=supermarket', 'shop=department_store'], checks: ['ordering'], priority: 3 },
]

/** Cities searched by default (Ayava is in Dehradun); editable in Growth settings. */
export const DEFAULT_CITIES = ['Dehradun', 'Rishikesh', 'Haridwar', 'Mussoorie', 'Haldwani', 'Roorkee', 'Delhi NCR']
