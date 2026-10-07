import {
  DeliveryMode,
  ParcelStatus,
  PaymentRequestStatus,
  PrismaClient,
  Role,
  TicketStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_STATUS_CATEGORIES } from '../src/status-categories/status-category.defaults';

/**
 * Resets the database to the Umbrella demo dataset.
 * Mirrors umbrella/web/src/lib/mock-data.ts so mock mode and the real API show the same data.
 */
const prisma = new PrismaClient();

type SeedUser = {
  key: UserKey;
  name: string;
  email: string;
  role: Role;
  phone: string;
  password: string;
  agency?: AgencyKey;
};

type UserKey =
  | 'super'
  | 'admin'
  | 'expediteur'
  | 'livreur'
  | 'client'
  | 'livreur2'
  | 'chef'
  | 'support'
  | 'pickup'
  | 'magasinier'
  | 'finance';
type ZoneKey = 'tunis' | 'sahel' | 'sfax';
type AgencyKey = 'tunis' | 'sousse' | 'sfax';

type SeedParcel = {
  code: string;
  recipientName: string;
  phone: string;
  governorate: string;
  city: string;
  address: string;
  price: number;
  notes: string | null;
  designation?: string;
  status: ParcelStatus;
  mode: DeliveryMode;
  bordereauUrl: string | null;
  daysAgo: number;
  driver?: UserKey;
  zone?: ZoneKey;
  timeline?: Array<{ daysAgo: number; label: string; status?: ParcelStatus }>;
};

const USERS: SeedUser[] = [
  {
    key: 'super',
    name: 'Super Admin',
    email: 'super@umbrella.tn',
    role: Role.SUPER_ADMIN,
    phone: '20000001',
    password: 'Super@12345',
  },
  {
    key: 'admin',
    name: 'Umbrella Admin',
    email: 'admin@umbrella.tn',
    role: Role.ADMIN,
    phone: '20000000',
    password: 'Admin@12345',
  },
  {
    key: 'expediteur',
    name: 'Demo Expéditeur',
    email: 'expediteur@umbrella.tn',
    role: Role.EXPEDITEUR,
    phone: '57120677',
    password: 'Expediteur@12345',
  },
  {
    key: 'livreur',
    name: 'Demo Livreur',
    email: 'livreur@umbrella.tn',
    role: Role.LIVREUR,
    phone: '22000000',
    password: 'Livreur@12345',
  },
  {
    key: 'client',
    name: 'Demo Client',
    email: 'client@umbrella.tn',
    role: Role.CLIENT,
    phone: '51926850',
    password: 'Client@12345',
  },
  {
    key: 'livreur2',
    name: 'Karim Ben Salah',
    email: 'livreur2@umbrella.tn',
    role: Role.LIVREUR,
    phone: '22000001',
    password: 'Livreur@12345',
  },
  {
    key: 'chef',
    name: 'Chef Agence Tunis',
    email: 'chef@umbrella.tn',
    role: Role.CHEF_AGENCE,
    phone: '23000001',
    password: 'Chef@12345',
    agency: 'tunis',
  },
  {
    key: 'support',
    name: 'Support Retours Tunis',
    email: 'support@umbrella.tn',
    role: Role.SUPPORT,
    phone: '23000002',
    password: 'Support@12345',
    agency: 'tunis',
  },
  {
    key: 'pickup',
    name: 'Pickup Tunis',
    email: 'pickup@umbrella.tn',
    role: Role.PICKUP,
    phone: '23000003',
    password: 'Pickup@12345',
    agency: 'tunis',
  },
  {
    key: 'magasinier',
    name: 'Magasinier Tunis',
    email: 'magasinier@umbrella.tn',
    role: Role.MAGASINIER,
    phone: '23000004',
    password: 'Magasin@12345',
    agency: 'tunis',
  },
  {
    key: 'finance',
    name: 'Finance Umbrella',
    email: 'finance@umbrella.tn',
    role: Role.FINANCE,
    phone: '24000001',
    password: 'Finance@12345',
  },
];

const AGENCIES: Array<{
  key: AgencyKey;
  name: string;
  governorate: string;
}> = [
  { key: 'tunis', name: 'Agence Tunis', governorate: 'Tunis' },
  { key: 'sousse', name: 'Agence Sousse', governorate: 'Sousse' },
  { key: 'sfax', name: 'Agence Sfax', governorate: 'Sfax' },
];

const ZONES: Array<{
  key: ZoneKey;
  name: string;
  governorate: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}> = [
  {
    key: 'tunis',
    name: 'Grand Tunis',
    governorate: 'Tunis',
    centerLat: 36.8065,
    centerLng: 10.1815,
    radiusKm: 25,
  },
  {
    key: 'sahel',
    name: 'Sahel',
    governorate: 'Sousse',
    centerLat: 35.8254,
    centerLng: 10.6369,
    radiusKm: 40,
  },
  {
    key: 'sfax',
    name: 'Sfax Métropole',
    governorate: 'Sfax',
    centerLat: 34.7478,
    centerLng: 10.7662,
    radiusKm: 30,
  },
];

const PARCELS: SeedParcel[] = [
  {
    code: 'UMB-ATT-001',
    recipientName: 'Demo Client',
    phone: '51926850',
    governorate: 'Ariana',
    city: 'Ariana',
    address: 'Cité Ennasr 2',
    price: 49.9,
    notes: 'Parfum',
    designation: 'Parfum',
    status: ParcelStatus.EN_ATTENTE,
    mode: DeliveryMode.EXTERNAL,
    bordereauUrl: 'https://example.com/bordereau.pdf',
    daysAgo: 1,
    timeline: [
      { daysAgo: 1, label: 'Colis créé' },
      {
        daysAgo: 1,
        label: "En attente d'enlèvement",
        status: ParcelStatus.EN_ATTENTE,
      },
    ],
  },
  {
    code: 'UMB-COURS-001',
    recipientName: 'Demo Client',
    phone: '51926850',
    governorate: 'Tunis',
    city: 'Tunis',
    address: 'Avenue Habib Bourguiba 12',
    price: 55,
    notes: 'Livres',
    designation: 'Livres',
    status: ParcelStatus.EN_COURS,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 0,
    driver: 'livreur',
    zone: 'tunis',
    timeline: [
      { daysAgo: 2, label: 'Colis créé' },
      { daysAgo: 1, label: 'Enlevé', status: ParcelStatus.ENLEVES },
      {
        daysAgo: 0,
        label: 'En cours de livraison',
        status: ParcelStatus.EN_COURS,
      },
    ],
  },
  {
    code: 'UMB-LIV-001',
    recipientName: 'Demo Client',
    phone: '51926850',
    governorate: 'Tunis',
    city: 'La Marsa',
    address: 'Corniche',
    price: 45.5,
    notes: 'Demo paiement',
    designation: 'Accessoires',
    status: ParcelStatus.LIVRES,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 4,
    driver: 'livreur',
    zone: 'tunis',
    timeline: [
      { daysAgo: 5, label: 'Colis créé' },
      { daysAgo: 4, label: 'Livré', status: ParcelStatus.LIVRES },
    ],
  },
  {
    code: 'UMB-ENL-001',
    recipientName: 'Amira Trabelsi',
    phone: '51926850',
    governorate: 'Ben Arous',
    city: 'Ezzahra',
    address: 'Avenue Habib Bourguiba',
    price: 28,
    notes: 'Vêtements',
    status: ParcelStatus.A_ENLEVER,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 2,
    driver: 'livreur',
    zone: 'tunis',
  },
  {
    code: 'UMB-ECH-001',
    recipientName: 'Demo Client',
    phone: '51926850',
    governorate: 'Mahdia',
    city: 'Ksour Essaf',
    address: 'Rue 54 Amilcar',
    price: 22,
    notes: 'Échange taille',
    status: ParcelStatus.ECHANGES,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 6,
    driver: 'livreur',
  },
  {
    code: 'UMB-DEP-001',
    recipientName: 'Hedi Mansouri',
    phone: '51926850',
    governorate: 'Sfax',
    city: 'Sfax',
    address: 'Route de Gabès km 3',
    price: 95,
    notes: 'Pièces auto',
    status: ParcelStatus.AU_DEPOT,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 3,
    driver: 'livreur2',
    zone: 'sfax',
  },
  {
    code: 'UMB-EXT-001',
    recipientName: 'Sami Gharbi',
    phone: '51926850',
    governorate: 'Sousse',
    city: 'Sousse',
    address: 'Boulevard 14 Janvier',
    price: 120,
    notes: 'Tablette',
    status: ParcelStatus.AU_DEPOT,
    mode: DeliveryMode.EXTERNAL,
    bordereauUrl: 'https://example.com/bordereau-ext.pdf',
    daysAgo: 2,
  },
  {
    code: 'UMB-RET-001',
    recipientName: 'Inconnu',
    phone: '51926850',
    governorate: 'Kairouan',
    city: 'Kairouan',
    address: 'Adresse incomplete',
    price: 40,
    notes: 'Retour',
    status: ParcelStatus.RETOUR_DEFINITIF,
    mode: DeliveryMode.EXTERNAL,
    bordereauUrl: null,
    daysAgo: 10,
  },
  {
    code: 'UMB-LIVP-001',
    recipientName: 'Demo Client',
    phone: '51926850',
    governorate: 'Ariana',
    city: 'Raoued',
    address: 'Route de Bizerte',
    price: 67,
    notes: 'Cosmétiques',
    status: ParcelStatus.LIVRES_PAYES,
    mode: DeliveryMode.EXTERNAL,
    bordereauUrl: null,
    daysAgo: 8,
  },
  {
    code: 'UMB-VERIF-001',
    recipientName: 'Nour Ben Ali',
    phone: '51926850',
    governorate: 'Bizerte',
    city: 'Bizerte',
    address: 'Avenue Habib Thameur',
    price: 88,
    notes: 'Montre',
    status: ParcelStatus.A_VERIFIER,
    mode: DeliveryMode.EXTERNAL,
    bordereauUrl: null,
    daysAgo: 5,
  },
  {
    code: 'UMB-ATT-002',
    recipientName: 'Karim Jebali',
    phone: '51926850',
    governorate: 'Nabeul',
    city: 'Hammamet',
    address: 'Zone touristique',
    price: 36.5,
    notes: 'Chaussures',
    designation: 'Chaussures',
    status: ParcelStatus.EN_ATTENTE,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 0,
  },
  {
    code: 'UMB-COURS-002',
    recipientName: 'Salma Mejri',
    phone: '51926850',
    governorate: 'Monastir',
    city: 'Monastir',
    address: 'Route de la plage',
    price: 72,
    notes: 'Électronique',
    designation: 'Électronique',
    status: ParcelStatus.EN_COURS,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 1,
    driver: 'livreur',
    zone: 'tunis',
  },
  {
    code: 'UMB-LIV-002',
    recipientName: 'Youssef Khelifi',
    phone: '51926850',
    governorate: 'Tunis',
    city: 'Le Bardo',
    address: 'Avenue de la République',
    price: 41,
    notes: 'Cosmétiques',
    designation: 'Cosmétiques',
    status: ParcelStatus.LIVRES,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 2,
    driver: 'livreur',
    zone: 'tunis',
  },
  {
    code: 'UMB-DEP-002',
    recipientName: 'Rim Chaabane',
    phone: '51926850',
    governorate: 'Sfax',
    city: 'Sakiet Ezzit',
    address: 'Cité el Ons',
    price: 58,
    notes: 'Maison',
    designation: 'Articles maison',
    status: ParcelStatus.AU_DEPOT,
    mode: DeliveryMode.INTERNAL,
    bordereauUrl: null,
    daysAgo: 1,
    driver: 'livreur2',
    zone: 'sfax',
  },
];

const TICKETS: Array<{
  title: string;
  description: string;
  status: TicketStatus;
  daysAgo: number;
  parcel: string;
  by: UserKey;
}> = [
  {
    title: 'Colis endommagé à la livraison',
    description: 'Le carton était ouvert.',
    status: TicketStatus.EN_COURS,
    daysAgo: 1,
    parcel: 'UMB-LIV-001',
    by: 'client',
  },
  {
    title: 'Retard de livraison Sahel',
    description: 'Client relance depuis 48h.',
    status: TicketStatus.EN_COURS,
    daysAgo: 2,
    parcel: 'UMB-COURS-001',
    by: 'expediteur',
  },
  {
    title: 'Changement d’adresse',
    description: 'Passer à Cité Ennasr.',
    status: TicketStatus.RESOLU,
    daysAgo: 4,
    parcel: 'UMB-ATT-001',
    by: 'client',
  },
];

const PAYMENTS: Array<{
  amount: number;
  status: PaymentRequestStatus;
  note: string;
  daysAgo: number;
  items: Array<{ parcel: string; amount: number }>;
}> = [
  {
    amount: 100.5,
    status: PaymentRequestStatus.EN_DEMANDE,
    note: 'Demande COD',
    daysAgo: 1,
    items: [
      { parcel: 'UMB-LIV-001', amount: 45.5 },
      { parcel: 'UMB-LIVP-001', amount: 55 },
    ],
  },
  {
    amount: 67,
    status: PaymentRequestStatus.PAYE,
    note: 'Déjà réglé',
    daysAgo: 7,
    items: [{ parcel: 'UMB-LIVP-001', amount: 67 }],
  },
  {
    amount: 95,
    status: PaymentRequestStatus.APPROUVE,
    note: 'En attente versement',
    daysAgo: 2,
    items: [{ parcel: 'UMB-DEP-001', amount: 95 }],
  },
];

function daysAgo(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d;
}

async function resetTables() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "PaymentItem", "PaymentRequest", "Ticket", "ParcelEvent", "Parcel", "Zone", "User", "StatusCategory", "Agency", "DeliveryRoute", "Message", "ConversationParticipant", "CallSession", "Conversation" RESTART IDENTITY CASCADE',
  );
}

async function main() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.SEED_ALLOW_RESET !== 'true'
  ) {
    throw new Error(
      'Refusing to reset a production database. Set SEED_ALLOW_RESET=true to override.',
    );
  }

  console.log('Resetting Umbrella demo data…');
  await resetTables();

  const GOVS = [
    'Ariana',
    'Béja',
    'Ben Arous',
    'Bizerte',
    'Gabès',
    'Gafsa',
    'Jendouba',
    'Kairouan',
    'Kasserine',
    'Kébili',
    'La Mannouba',
    'Le Kef',
    'Mahdia',
    'Médenine',
    'Monastir',
    'Nabeul',
    'Sfax',
    'Sidi Bouzid',
    'Siliana',
    'Sousse',
    'Tataouine',
    'Tozeur',
    'Tunis',
    'Zaghouan',
  ];
  const INTERNAL_GOVS = new Set(['Tunis', 'Ariana', 'Ben Arous', 'La Mannouba']);
  for (const governorate of GOVS) {
    await prisma.deliveryRoute.create({
      data: {
        governorate,
        mode: INTERNAL_GOVS.has(governorate)
          ? DeliveryMode.INTERNAL
          : DeliveryMode.EXTERNAL,
      },
    });
  }

  const agencyIds = {} as Record<AgencyKey, number>;
  for (const a of AGENCIES) {
    const row = await prisma.agency.create({
      data: { name: a.name, governorate: a.governorate, isActive: true },
    });
    agencyIds[a.key] = row.id;
  }

  const agencyByGov = new Map(
    AGENCIES.map((a) => [a.governorate.toLowerCase(), agencyIds[a.key]]),
  );

  const userIds = {} as Record<UserKey, number>;
  for (const u of USERS) {
    const row = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        role: u.role,
        phone: u.phone,
        password: await bcrypt.hash(u.password, 12),
        agencyId: u.agency ? agencyIds[u.agency] : null,
      },
    });
    userIds[u.key] = row.id;
  }

  const zoneIds = {} as Record<ZoneKey, number>;
  for (const z of ZONES) {
    const row = await prisma.zone.create({
      data: {
        name: z.name,
        governorate: z.governorate,
        centerLat: z.centerLat,
        centerLng: z.centerLng,
        radiusKm: z.radiusKm,
        createdById: userIds.admin,
      },
    });
    zoneIds[z.key] = row.id;
  }

  const parcelIds: Record<string, number> = {};
  for (const p of PARCELS) {
    const createdAt = daysAgo(p.daysAgo);
    const timeline = p.timeline ?? [
      { daysAgo: p.daysAgo, label: 'Colis créé' },
    ];
    const row = await prisma.parcel.create({
      data: {
        code: p.code,
        recipientName: p.recipientName,
        phone: p.phone,
        governorate: p.governorate,
        city: p.city,
        address: p.address,
        price: p.price,
        notes: p.notes,
        designation: p.designation,
        status: p.status,
        mode: p.mode,
        bordereauUrl: p.bordereauUrl,
        paymentMode: 'espece',
        senderId: userIds.expediteur,
        driverId: p.driver ? userIds[p.driver] : null,
        zoneId: p.zone ? zoneIds[p.zone] : null,
        agencyId: agencyByGov.get(p.governorate.toLowerCase()) ?? null,
        createdAt,
        events: {
          create: timeline.map((e) => ({
            label: e.label,
            status: e.status ?? null,
            createdAt: daysAgo(e.daysAgo),
          })),
        },
      },
    });
    parcelIds[p.code] = row.id;
  }

  for (const t of TICKETS) {
    await prisma.ticket.create({
      data: {
        title: t.title,
        description: t.description,
        status: t.status,
        parcelId: parcelIds[t.parcel],
        createdById: userIds[t.by],
        createdAt: daysAgo(t.daysAgo),
      },
    });
  }

  for (const pay of PAYMENTS) {
    await prisma.paymentRequest.create({
      data: {
        amount: pay.amount,
        status: pay.status,
        note: pay.note,
        senderId: userIds.expediteur,
        createdAt: daysAgo(pay.daysAgo),
        items: {
          create: pay.items.map((i) => ({
            parcelId: parcelIds[i.parcel],
            amount: i.amount,
          })),
        },
      },
    });
  }

  await prisma.statusCategory.createMany({
    data: DEFAULT_STATUS_CATEGORIES.map((row) => ({
      key: row.key,
      label: row.label,
      color: row.color,
      icon: row.icon,
      sortOrder: row.sortOrder,
      isActive: true,
    })),
  });

  const chatParcelId =
    parcelIds['UMB-COURS-001'] ??
    Object.values(parcelIds).find((id) => id != null);
  const chatAt = daysAgo(0);
  chatAt.setMinutes(chatAt.getMinutes() - 15);
  const conversation = await prisma.conversation.create({
    data: {
      parcelId: chatParcelId ?? null,
      lastMessageAt: chatAt,
      participants: {
        create: [
          { userId: userIds.livreur, lastReadAt: chatAt },
          { userId: userIds.client },
        ],
      },
      messages: {
        create: {
          senderId: userIds.livreur,
          body: 'Bonjour, je suis en route pour votre livraison.',
          createdAt: chatAt,
        },
      },
    },
  });

  console.log(
    `Seeded ${USERS.length} users, ${AGENCIES.length} agencies, ${ZONES.length} zones, ${PARCELS.length} parcels, ${TICKETS.length} tickets, ${PAYMENTS.length} payments, ${DEFAULT_STATUS_CATEGORIES.length} status categories, conversation #${conversation.id} (livreur↔client).`,
  );
  for (const u of USERS) console.log(`  ${u.email.padEnd(26)} ${u.password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
