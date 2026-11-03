# Demo script: hospital reception (draft v1, 2026-10-26)

**Setting:** a hospital reception desk. A Deaf parent arrives with their child.
- **Patient → staff:** the patient signs. The recognizer turns it into text on the staff screen.
- **Staff → patient:** the staff member speaks. Speech becomes text, a Meta open-weights model (Muse Spark Open, served on Baseten) converts the text into a sequence of known signs, and the avatar signs it. Show this label on screen in the video, since it counts toward the open-weights bonus prize.

> **Scope: communication access only.** The system never diagnoses, triages or gives medical advice. It only relays what the two people say to each other. The avatar signs only what the staff member said, and never generates content of its own.

## Dialogue

| # | Who | Says / signs | Gloss (signs used) |
|---|---|---|---|
| 1 | Patient | "Сайн байна уу. Би сонсголгүй." | САЙН_БАЙНА_УУ · СОНСГОЛГҮЙ◐ |
| 2 | Staff | "Сайн байна уу. Танд юу тохиолдов?" | САЙН_БАЙНА_УУ · ЯАСАН_БЭ |
| 3 | Patient | "Миний хүүхэд өвдөөд байна." | МИНИЙ◐ · ХҮҮХЭД◐ · ӨВДӨХ★ |
| 4 | Staff | "Хаана нь өвдөж байна?" | ӨВДӨХ★ · (ask with face/eyebrows) |
| 5 | Patient | "Ходоод." | ХОДООД★ |
| 6 | Staff | "Ойлголоо. Эмчийг түр хүлээнэ үү." | ОЙЛГОЛОО · ЭМЧ · ХҮЛЭЭХ |
| 7 | Patient | "Уучлаарай, дахин хэлнэ үү." | УУЧЛААРАЙ · ДАХИН★ |
| 8 | Staff | (the avatar repeats line 6) | ОЙЛГОЛОО · ЭМЧ · ХҮЛЭЭХ |
| 9 | Patient | "Баярлалаа." | БАЯРЛАЛАА |
| 10 | Staff | "Баяртай, эрүүл болоорой." | БАЯРТАЙ |

Legend: ★ = must be recorded. Status per direction is in the table below.

## Signs needed (status 2026-10-31)

Two separate models: the **avatar** plays T-pose clips (staff -> patient), the **recognizer** is trained on A-pose clips (patient -> staff).

| Direction | Ready | To record |
|---|---|---|
| Avatar (staff lines 2, 4, 6, 8, 10) | All 7: САЙН_БАЙНА_УУ, ЯАСАН_БЭ, ӨВДӨХ, ОЙЛГОЛОО, ЭМЧ, ХҮЛЭЭХ (added 10-31), БАЯРТАЙ | — |
| Recognizer (patient lines 1, 3, 5, 7, 9) | All 9: САЙН_БАЙНА_УУ, СОНСГОЛГҮЙ, МИНИЙ, ХҮҮХЭД, ӨВДӨХ, ХОДООД, УУЧЛААРАЙ, ДАХИН, БАЯРЛАЛАА (15-class model, 98.3% clip accuracy held out by video; same through the live segmenter) | — |

`signs/vocab.json` lists the avatar signs only, since those are what glossmap may choose.

## Open questions
- **МЭДЭЖ_АВЛАА is not an MSL sign** (signer, 10-31). Line 6 uses ОЙЛГОЛОО (OK-hand at the face), recorded as `oilgoloo`.
- **ЭЭ_ДАХИН_ДАХИН = an expression of regret ("халаглах"), NOT "please repeat"** (confirmed 10-29). Decided: record ДАХИН ("again") for line 7.
- **Line 4 "Хаана?":** in MSL is it a separate sign, or a question face plus pointing? Check the e-dictionary.
- **Staff speech-to-text:** Mongolian is not among Muse Voice Transcribe's 25 validated languages, but the API accepts `languageBias: ["mongolian"]`. Quality test needs a recording of the staff lines. Fallback: the existing ASR.
- **What Meta's model adds:** staff can phrase things freely ("Юу болсон бэ?", "Танд юу тохиолдов?", "Яасан бэ?") and the model maps them to the same known sign. Words with no sign are shown as text on screen, never invented.
