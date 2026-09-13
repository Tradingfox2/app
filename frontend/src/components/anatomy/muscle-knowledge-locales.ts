import type { SupportedLocale } from "../../api";
import type { MuscleKnowledge } from "./muscle-knowledge";
import type { MuscleSlug } from "./muscle-types";

type KnowledgeText = Pick<MuscleKnowledge, "role" | "why" | "insight">;
type TranslatedLocale = Exclude<SupportedLocale, "en">;

const translatedKnowledge: Record<TranslatedLocale, Record<MuscleSlug, KnowledgeText>> = {
  fr: {
    chest: { role: "Poussée horizontale et adduction du bras.", why: "La force de poussée stabilise l'épaule et soutient les gestes sportifs et quotidiens.", insight: "Cherchez un étirement complet en bas des développés et écartés ; l'incliné cible le haut des pectoraux." },
    back: { role: "Rétraction du haut du dos, contrôle des omoplates et posture.", why: "Un dos fort corrige la posture assise, stabilise les charges lourdes et protège les épaules.", insight: "Équilibrez chaque poussée par un tirage et marquez une pause omoplates serrées." },
    lats: { role: "Tirage du bras vers le bas et l'arrière, stabilité du tronc.", why: "Les dorsaux renforcent tractions et tirages tout en stabilisant la colonne sous charge.", insight: "Amenez les coudes vers les hanches et laissez les dorsaux s'étirer en haut du tirage." },
    shoulders: { role: "Poussée verticale et élévation du bras dans tous les plans.", why: "Des deltoïdes équilibrés stabilisent une articulation très sollicitée à l'entraînement.", insight: "Les faisceaux latéraux tolèrent des charges légères fréquentes ; travaillez aussi l'arrière pour la posture." },
    biceps: { role: "Flexion du coude et supination de l'avant-bras.", why: "Les biceps assistent tous les tirages et protègent les tendons du coude.", insight: "Le dos les sollicite déjà ; 6 à 10 séries directes en amplitude complète suffisent souvent." },
    triceps: { role: "Extension du coude ; majeure partie du volume du bras.", why: "Les triceps assurent le verrouillage des poussées et contribuent fortement au volume des bras.", insight: "Les extensions au-dessus de la tête chargent le chef long en position étirée." },
    forearms: { role: "Prise, flexion et extension du poignet.", why: "La force de préhension soutient la santé à long terme et limite souvent soulevés de terre et tirages.", insight: "Les marches du fermier et suspensions entraînent la prise ; gardez les flexions de poignet légères." },
    quads: { role: "Extension du genou, station debout, montée et saut.", why: "Des quadriceps forts préservent les genoux, l'autonomie et la puissance du bas du corps.", insight: "La profondeur compte : squats complets et fentes développent mieux les quadriceps que les répétitions partielles." },
    hamstrings: { role: "Flexion du genou et extension de la hanche.", why: "Des ischio-jambiers forts améliorent le sprint et protègent genou et muscle des blessures.", insight: "Travaillez leurs deux fonctions chaque semaine : charnière de hanche et flexion de genou." },
    glutes: { role: "Extension, abduction et rotation de la hanche.", why: "Le plus grand muscle du corps propulse course et saut tout en soulageant dos et genoux.", insight: "Combinez hip thrusts en contraction et squats ou fentes profonds en étirement." },
    calves: { role: "Extension de la cheville et ressort de la marche ou course.", why: "Des mollets forts stabilisent la cheville, améliorent la course et réduisent le risque au tendon d'Achille.", insight: "Ils récupèrent vite : travaillez-les souvent avec un étirement lent et profond." },
    abs: { role: "Flexion de la colonne et gainage sous charge.", why: "Un tronc fort transmet la force et protège la région lombaire pendant les mouvements lourds.", insight: "Chargez-les comme les autres muscles plutôt que d'accumuler des centaines de répétitions faciles." },
    obliques: { role: "Rotation et résistance à la rotation du tronc.", why: "Les obliques résistent aux torsions sous charge qui fragilisent souvent le bas du dos.", insight: "Privilégiez Pallof press, planches latérales et portés asymétriques aux crunchs en rotation." },
    lower_back: { role: "Extension de la colonne et gainage isométrique.", why: "Des érecteurs forts rendent le dos plus résistant au quotidien et au soulevé de terre.", insight: "Squats et charnières les sollicitent déjà ; ajoutez peu d'extensions et évitez l'échec." },
  },
  de: {
    chest: { role: "Horizontales Drücken und Heranführen des Arms.", why: "Druckkraft stabilisiert die Schulter und unterstützt Bewegungen in Alltag und Sport.", insight: "Nutze die volle Dehnung unten bei Press- und Flybewegungen; Schrägbank betont die obere Brust." },
    back: { role: "Rückführung der Schulterblätter, Kontrolle und Haltung.", why: "Ein starker oberer Rücken gleicht Sitzhaltung aus, stabilisiert schwere Lifts und schützt die Schultern.", insight: "Gleiche jedes Drücken mit Ziehen aus und halte kurz mit zusammengezogenen Schulterblättern." },
    lats: { role: "Zieht den Arm nach unten und hinten und stabilisiert den Rumpf.", why: "Der Latissimus stärkt Klimmzüge und Rudern und stabilisiert die Wirbelsäule unter Last.", insight: "Ziehe die Ellbogen zu den Hüften und erlaube oben eine vollständige Dehnung." },
    shoulders: { role: "Überkopfdrücken und Armheben in allen Ebenen.", why: "Ausgeglichene Deltamuskeln stabilisieren das im Training stark beanspruchte Schultergelenk.", insight: "Seitliche Deltas vertragen häufiges leichtes Training; trainiere die hinteren für eine gute Haltung mit." },
    biceps: { role: "Beugt den Ellbogen und dreht den Unterarm nach außen.", why: "Der Bizeps hilft bei jedem Zug und schützt die beim Rudern belasteten Ellbogensehnen.", insight: "Rückentraining belastet ihn bereits; 6 bis 10 direkte Sätze mit voller Dehnung reichen oft." },
    triceps: { role: "Streckt den Ellbogen und bildet den Großteil des Oberarms.", why: "Trizepskraft beendet Druckbewegungen und trägt stärker zum Armumfang bei als der Bizeps.", insight: "Überkopfstrecken belastet den langen Kopf in gedehnter Position besonders wirksam." },
    forearms: { role: "Griff sowie Beugung und Streckung des Handgelenks.", why: "Griffkraft unterstützt langfristige Gesundheit und begrenzt oft Kreuzheben und Rudern.", insight: "Farmer's Walks und Hängen trainieren funktionell; Handgelenkcurls leicht und häufig ausführen." },
    quads: { role: "Streckt das Knie beim Stehen, Steigen und Springen.", why: "Starke Quadrizeps erhalten Kniegesundheit, Selbstständigkeit und Unterkörperleistung.", insight: "Tiefe zählt: volle Kniebeugen und Split Squats entwickeln mehr als Teilwiederholungen." },
    hamstrings: { role: "Beugt das Knie und streckt die Hüfte.", why: "Starke Beinbeuger verbessern den Sprint und schützen Knie und Muskulatur vor Verletzungen.", insight: "Trainiere beide Aufgaben wöchentlich: Hüftbeuge wie RDL und Kniebeugung wie Leg Curl." },
    glutes: { role: "Streckt, spreizt und rotiert die Hüfte.", why: "Der größte Muskel treibt Sprint und Sprung an und entlastet unteren Rücken und Knie.", insight: "Kombiniere Hip Thrusts in Kontraktion mit tiefen Kniebeugen oder Ausfallschritten in Dehnung." },
    calves: { role: "Streckt das Sprunggelenk und federt Gehen und Laufen.", why: "Starke Waden stabilisieren den Knöchel, verbessern Laufökonomie und schützen die Achillessehne.", insight: "Sie erholen sich schnell: häufig mit langsamer, tiefer Dehnung trainieren." },
    abs: { role: "Beugt die Wirbelsäule und stabilisiert unter Last.", why: "Ein starker Rumpf überträgt Kraft und schützt die Lendenwirbelsäule bei schweren Lifts.", insight: "Trainiere sie belastet wie andere Muskeln statt mit hunderten leichten Wiederholungen." },
    obliques: { role: "Dreht den Rumpf und widersteht Rotation.", why: "Die seitliche Bauchmuskulatur verhindert belastete Verdrehungen, die den unteren Rücken gefährden.", insight: "Pallof Press, Side Planks und einseitiges Tragen sind besser als drehende Crunches." },
    lower_back: { role: "Streckt die Wirbelsäule und stabilisiert isometrisch.", why: "Starke Rückenstrecker machen den Rücken im Alltag und beim Kreuzheben belastbarer.", insight: "Kniebeugen und Hüftbeugen trainieren ihn bereits; wenige Extensions ergänzen, nie bis zum Versagen." },
  },
  es: {
    chest: { role: "Empuje horizontal y aducción del brazo.", why: "La fuerza de empuje estabiliza el hombro y mejora gestos cotidianos y deportivos.", insight: "Busca un estiramiento completo al bajar presses y aperturas; el inclinado enfatiza la parte superior." },
    back: { role: "Retracción escapular, control de los omóplatos y postura.", why: "Una espalda alta fuerte compensa la postura sentada, estabiliza cargas y protege los hombros.", insight: "Equilibra cada empuje con un tirón y pausa con los omóplatos juntos." },
    lats: { role: "Lleva el brazo abajo y atrás y estabiliza el tronco.", why: "Los dorsales potencian dominadas y remos y estabilizan la columna bajo carga.", insight: "Lleva los codos hacia las caderas y deja que los dorsales se estiren por completo arriba." },
    shoulders: { role: "Empuje vertical y elevación del brazo en todos los planos.", why: "Unos deltoides equilibrados estabilizan una articulación muy exigida en el gimnasio.", insight: "El deltoide lateral tolera cargas ligeras frecuentes; trabaja también el posterior para la postura." },
    biceps: { role: "Flexión del codo y supinación del antebrazo.", why: "El bíceps ayuda en cada tirón y protege los tendones del codo.", insight: "El día de espalda ya lo trabaja; suelen bastar 6-10 series directas con estiramiento completo." },
    triceps: { role: "Extensión del codo y mayor parte del volumen del brazo.", why: "El tríceps completa los empujes y aporta más tamaño al brazo que el bíceps.", insight: "Las extensiones sobre la cabeza cargan la porción larga en posición estirada." },
    forearms: { role: "Agarre, flexión y extensión de la muñeca.", why: "La fuerza de agarre favorece la salud a largo plazo y suele limitar pesos muertos y remos.", insight: "Los paseos del granjero y colgarse entrenan el agarre; usa cargas ligeras en curls de muñeca." },
    quads: { role: "Extensión de rodilla al levantarse, subir y saltar.", why: "Unos cuádriceps fuertes conservan la salud de la rodilla, la autonomía y la potencia inferior.", insight: "La profundidad importa: sentadillas y zancadas completas superan a las repeticiones parciales." },
    hamstrings: { role: "Flexión de rodilla y extensión de cadera.", why: "Unos isquiotibiales fuertes mejoran el sprint y protegen rodilla y músculo de lesiones.", insight: "Entrena ambas funciones cada semana: bisagra de cadera y curl de rodilla." },
    glutes: { role: "Extensión, abducción y rotación de cadera.", why: "El mayor músculo del cuerpo impulsa carreras y saltos y descarga espalda baja y rodillas.", insight: "Combina hip thrust en contracción con sentadillas o zancadas profundas en estiramiento." },
    calves: { role: "Flexión plantar del tobillo y resorte al caminar o correr.", why: "Unos gemelos fuertes estabilizan el tobillo, mejoran la carrera y protegen el tendón de Aquiles.", insight: "Se recuperan rápido: entrénalos a menudo con un estiramiento lento y profundo." },
    abs: { role: "Flexión de columna y estabilización bajo carga.", why: "Un core fuerte transfiere fuerza y protege la zona lumbar en levantamientos pesados.", insight: "Entrénalos con carga como cualquier músculo, no con cientos de repeticiones fáciles." },
    obliques: { role: "Rotación y resistencia a la rotación del tronco.", why: "Los oblicuos resisten giros bajo carga que suelen lesionar la zona lumbar.", insight: "Prioriza Pallof press, planchas laterales y cargas unilaterales sobre crunches con giro." },
    lower_back: { role: "Extensión de columna y estabilización isométrica.", why: "Unos erectores fuertes hacen la espalda más resistente en la vida diaria y el peso muerto.", insight: "Sentadillas y bisagras ya los trabajan; añade pocas extensiones y evita el fallo." },
  },
  it: {
    chest: { role: "Spinta orizzontale e adduzione del braccio.", why: "La forza di spinta stabilizza la spalla e sostiene i gesti quotidiani e sportivi.", insight: "Cerca un allungamento completo in basso in spinte e croci; l'inclinata enfatizza la parte alta." },
    back: { role: "Retrazione scapolare, controllo delle scapole e postura.", why: "Una schiena alta forte contrasta la postura seduta, stabilizza i carichi e protegge le spalle.", insight: "Bilancia ogni spinta con una tirata e fai una pausa con le scapole unite." },
    lats: { role: "Porta il braccio in basso e indietro e stabilizza il tronco.", why: "I dorsali potenziano trazioni e rematori e stabilizzano la colonna sotto carico.", insight: "Porta i gomiti verso i fianchi e lascia allungare completamente i dorsali in alto." },
    shoulders: { role: "Spinta sopra la testa e sollevamento del braccio su ogni piano.", why: "Deltoidi equilibrati stabilizzano un'articolazione molto sollecitata in palestra.", insight: "I deltoidi laterali tollerano carichi leggeri frequenti; allena anche i posteriori per la postura." },
    biceps: { role: "Flessione del gomito e supinazione dell'avambraccio.", why: "I bicipiti assistono ogni tirata e proteggono i tendini del gomito.", insight: "Il dorso li coinvolge già; spesso bastano 6-10 serie dirette in pieno allungamento." },
    triceps: { role: "Estensione del gomito e maggior parte del volume del braccio.", why: "La forza dei tricipiti completa le spinte e contribuisce molto alla massa del braccio.", insight: "Le estensioni sopra la testa caricano efficacemente il capo lungo in allungamento." },
    forearms: { role: "Presa, flessione ed estensione del polso.", why: "La forza di presa sostiene la salute nel tempo e spesso limita stacchi e rematori.", insight: "Farmer walk e sospensioni allenano la presa; mantieni leggeri i curl dei polsi." },
    quads: { role: "Estensione del ginocchio per alzarsi, salire e saltare.", why: "Quadricipiti forti preservano ginocchia, autonomia e potenza della parte inferiore.", insight: "La profondità conta: squat e affondi completi sviluppano più delle ripetizioni parziali." },
    hamstrings: { role: "Flessione del ginocchio ed estensione dell'anca.", why: "Femorali forti migliorano lo sprint e proteggono ginocchio e muscolo dagli infortuni.", insight: "Allena entrambe le funzioni ogni settimana: hip hinge e leg curl." },
    glutes: { role: "Estensione, abduzione e rotazione dell'anca.", why: "Il muscolo più grande spinge corsa e salto e riduce il carico su schiena e ginocchia.", insight: "Combina hip thrust in contrazione con squat o affondi profondi in allungamento." },
    calves: { role: "Flessione plantare della caviglia e spinta in cammino e corsa.", why: "Polpacci forti stabilizzano la caviglia, migliorano la corsa e proteggono il tendine d'Achille.", insight: "Recuperano rapidamente: allenali spesso con un allungamento lento e profondo." },
    abs: { role: "Flessione della colonna e stabilizzazione sotto carico.", why: "Un core forte trasferisce forza e protegge la zona lombare nei sollevamenti pesanti.", insight: "Allenali con carico come gli altri muscoli, invece di centinaia di ripetizioni facili." },
    obliques: { role: "Rotazione e resistenza alla rotazione del tronco.", why: "Gli obliqui resistono alle torsioni sotto carico che spesso danneggiano la zona lombare.", insight: "Preferisci Pallof press, plank laterali e trasporti unilaterali ai crunch con torsione." },
    lower_back: { role: "Estensione della colonna e stabilizzazione isometrica.", why: "Erettori forti rendono la schiena più resistente nella vita quotidiana e negli stacchi.", insight: "Squat e hip hinge li allenano già; aggiungi poche estensioni e non arrivare al cedimento." },
  },
};

export function localizeMuscleKnowledge(
  muscle: MuscleSlug,
  locale: SupportedLocale,
  knowledge: MuscleKnowledge,
): MuscleKnowledge {
  if (locale === "en") return knowledge;
  return { ...knowledge, ...translatedKnowledge[locale][muscle] };
}
