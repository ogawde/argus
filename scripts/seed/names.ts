/**
 * Static name pools for filler payees (synthetic only).
 * None of these first names or surnames are used by the scenario payees,
 * so filler payees can't accidentally look like S1-S9 or the hard negatives.
 */

export const FIRST_NAMES = [
  "Abel", "Adaeze", "Alma", "Amara", "Andre", "Beatriz", "Bram", "Camille", "Dara", "Dmitri",
  "Elif", "Emeka", "Farah", "Felix", "Gabriela", "Hana", "Hugo", "Idris", "Ingrid", "Isaac",
  "Jasmine", "Joaquin", "Kaito", "Katya", "Kofi", "Layla", "Leandro", "Mateo", "Mei", "Mira",
  "Nikolai", "Noor", "Olga", "Omar", "Paloma", "Pavel", "Quinn", "Rafael", "Rosa", "Sacha",
  "Selin", "Soren", "Tamar", "Teodor", "Uma", "Valentina", "Viktor", "Wanjiru", "Yara", "Zane",
  "Aaliyah", "Bruno", "Chiara", "Darius", "Esme", "Fatima", "Gideon", "Helena", "Ivo", "Jun",
  "Kira", "Lukas", "Marta", "Nils", "Odette", "Pilar", "Rhea", "Stefan", "Thalia", "Ugo",
  "Vera", "Wendell", "Ximena", "Yusuf", "Zora", "Anders", "Bianca", "Cyrus", "Delia", "Elio",
  "Freya", "Goran", "Hiro", "Ines", "Jorge", "Keiko", "Lorenzo", "Mona", "Nadir", "Oren",
  "Petra", "Ramon", "Sunita", "Tomas", "Ulla", "Vikram", "Wilma", "Xavier", "Yvonne", "Zeynep",
] as const;

export const LAST_NAMES = [
  "Abbott", "Acheampong", "Adeyemi", "Alvarez", "Andersson", "Aoki", "Bakker", "Barros", "Becker", "Bianchi",
  "Bjorklund", "Blanco", "Bose", "Brennan", "Cabrera", "Castillo", "Chaudhry", "Costa", "Dahl", "Delgado",
  "Demir", "Dlamini", "Dubois", "Eriksen", "Esposito", "Farouk", "Ferreira", "Fontaine", "Gallo", "Gupta",
  "Haddad", "Hansen", "Hashimoto", "Hoang", "Horvat", "Ibrahim", "Ivanov", "Jansen", "Jovanovic", "Kamau",
  "Kang", "Karlsson", "Khoury", "Kobayashi", "Kowalski", "Lacroix", "Larsen", "Lopes", "Lund", "Maldonado",
  "Marino", "Mbeki", "Moreau", "Mwangi", "Nakamura", "Naidoo", "Novak", "Nwosu", "Okada", "Oliveira",
  "Olsen", "Ortega", "Papadakis", "Park", "Pereira", "Petrov", "Quintero", "Rahman", "Reyes", "Rinaldi",
  "Rossi", "Saito", "Salazar", "Santos", "Schmidt", "Sekibo", "Serrano", "Silva", "Sorensen", "Takahashi",
  "Tran", "Ueda", "Vargas", "Varga", "Vasquez", "Vega", "Wagner", "Weber", "Yamada", "Yilmaz",
  "Zhang", "Zielinski", "Amadi", "Brandao", "Cardoso", "Dimitrov", "Engel", "Fournier", "Gustafsson", "Holm",
  "Iglesias", "Jaramillo", "Keller", "Lindgren", "Moretti", "Nilsson", "Orlov", "Prakash", "Ramos", "Strand",
] as const;

export const COUNTRIES = ["US", "GB", "DE", "FR", "ES", "BR", "IN", "NG", "KE", "JP", "SE", "MX", "CA", "AU"] as const;

export const EMAIL_DOMAINS = ["example.com", "example.net", "example.org"] as const;
