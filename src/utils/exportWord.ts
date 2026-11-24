import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, AlignmentType, BorderStyle, WidthType, VerticalAlign, ShadingType, TableLayoutType } from "docx";
import { saveAs } from "file-saver";

// استيراد الخطوط كـ ArrayBuffer (سيتم تحميلها ديناميكياً)
async function fetchFont(fontPath: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(fontPath);
    if (!response.ok) throw new Error(`خطأ تحميل الخط: ${fontPath}`);
    return await response.arrayBuffer();
  } catch (err) {
    // يمكنك هنا استخدام toast أو alert إذا أردت
    alert(`فشل تحميل الخط المطلوب: ${fontPath}`);
    throw err;
  }
}

export interface ShiftRow {
  index: number;
  rank: string;
  name: string;
  fileNumber: string | null;
  nationalId: string;
  jobTitle: string;
  department: string;
  attendance?: string;
  leave?: string;
  notes?: string;
}

export interface ExportWordOptions {
  date: string; // ex: الأحد الموافق 2025/8/3
  rows: ShiftRow[];
  notes: string[];
  manager: string;
  headerColor?: string;
  tableBorderColor?: string;
  selectedCategories?: string[];
  printDate?: string;
  lastShiftDate?: string;
}

export async function exportShiftsToWord(options: ExportWordOptions) {
  // تحميل الخطوط كـ ArrayBuffer
  const sultanBold = new Uint8Array(await fetchFont("/Sultan-bold.ttf"));
  const sultanMedium = new Uint8Array(await fetchFont("/Sultan-Medium.ttf"));
  const sultanNormal = new Uint8Array(await fetchFont("/Sultan-normal.ttf"));

  const tableWidth = 15728;
  const columnWidths = [426, 1561, 3402, 1134, 1417, 1418, 1984, 1560, 1701, 1125];
  const noSpacing = { before: 0, after: 0 };
  const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const headerBorder = { style: BorderStyle.SINGLE, size: 24, color: "000000" };
  const outerBorders = {
    top: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 24, color: "000000" },
    left: { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 24, color: "000000" },
    bottom: { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 24, color: "000000" },
    right: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 24, color: "000000" },
    insideHorizontal: thinBorder,
    insideVertical: thinBorder,
  };

  const makeParagraph = (
    text: string,
    options: {
      font?: string;
      size?: number;
      bold?: boolean;
      color?: string;
      shading?: string;
      line?: number;
    } = {}
  ) =>
    new Paragraph({
      children: [
        new TextRun({
          text,
          font: options.font || "Sultan Medium",
          size: options.size ?? 30,
          bold: options.bold,
          color: options.color || "000000",
          rightToLeft: true,
          shading: options.shading ? { type: ShadingType.CLEAR, color: "auto", fill: options.shading } : undefined,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { ...noSpacing, line: options.line ?? 240 },
      bidirectional: true,
    });

  const makeCell = (
    text: string,
    width: number,
    options: {
      font?: string;
      size?: number;
      bold?: boolean;
      color?: string;
      fill?: string;
      borders?: any;
      line?: number;
    } = {}
  ) =>
    new TableCell({
      children: [makeParagraph(text, options)],
      verticalAlign: VerticalAlign.CENTER,
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: options.fill || "FFFFFF" },
      borders: options.borders,
      margins: { top: 0, bottom: 0, left: 108, right: 108 },
    });

  const makeArabicRunsWithTimesNumbers = (
    text: string,
    options: {
      color?: string;
      size?: number;
      shading?: string;
      bold?: boolean;
    } = {}
  ) =>
    String(text || '')
      .split(/([0-9:\/().-]+)/g)
      .filter((part) => part.length > 0)
      .map((part) => {
        const isNumberPart = /^[0-9:\/().-]+$/.test(part);
        return new TextRun({
          text: part,
          font: isNumberPart ? "Times New Roman" : "Sultan Normal",
          size: options.size ?? 22,
          bold: options.bold,
          color: options.color || "000000",
          rightToLeft: true,
          shading: options.shading ? { type: ShadingType.CLEAR, color: "auto", fill: options.shading } : undefined,
        });
      });

  // إعداد المستند
  const doc = new Document({
    compatibility: {
      version: 15,
    },
    styles: {
      default: {
        document: {
          run: {
            font: "Sultan Normal",
            rightToLeft: true,
          },
        },
      },
      paragraphStyles: [
        {
          id: "TableHeader",
          name: "Table Header",
          run: {
            font: "Sultan Medium",
            size: 28,
            bold: false,
            color: "222222",
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: noSpacing,
          },
        },
        {
          id: "TableCell",
          name: "Table Cell",
          run: {
            font: "Sultan Medium",
            size: 30,
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: noSpacing,
          },
        },
        {
          id: "NoteText",
          name: "Note Text",
          run: {
            font: "Sultan Normal",
            size: 28,
          },
          paragraph: {
            alignment: AlignmentType.RIGHT,
          },
        },
        {
          id: "SignatureText",
          name: "Signature Text",
          run: {
            font: "Sultan Bold",
            size: 36,
            color: "808080",
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
          },
        },
      ],
    },
    fonts: [
      { name: "Sultan Bold", data: sultanBold as any },
      { name: "Sultan Medium", data: sultanMedium as any },
      { name: "Sultan Normal", data: sultanNormal as any },
    ],
    sections: [
      {
        properties: {
          page: {
            margin: { top: 284, right: 567, bottom: 238, left: 567, header: 0, footer: 284 },
            size: { width: 16838, height: 11906, orientation: "landscape" },
          },
        },
        children: (() => {
          const headers = [
            "م",
            "المسمى الوظيفي",
            "الاسم",
            "رقم الملف",
            "النقال",
            "المسمى الوظيفي",
            "الادارة",
            "حضور",
            "انصراف",
            "ملاحظات",
          ];

          const dateParts = (options.date || "").split("الموافق");
          const dateLabel = (dateParts[0] || options.date || "").trim();
          const dateValue = (dateParts[1] || "").trim();
          const dateDay = dateLabel.replace(/^يوم\s*/, "").trim();

          const dateRow = new TableRow({
            height: { value: 624, rule: "exact" },
            tableHeader: true,
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: dateValue ? "يوم " : dateLabel,
                        font: "Sultan Bold",
                        size: 40,
                        color: "000000",
                        rightToLeft: true,
                      }),
                      ...(dateValue
                        ? [
                            new TextRun({
                              text: dateDay,
                              font: "Sultan Bold",
                              size: 40,
                              color: "FF0000",
                              rightToLeft: true,
                            }),
                            new TextRun({
                              text: " الموافق ",
                              font: "Sultan Bold",
                              size: 40,
                              color: "000000",
                              rightToLeft: true,
                            }),
                          ]
                        : []),
                      ...(dateValue
                        ? [
                            new TextRun({
                              text: dateValue,
                              font: "Times New Roman",
                              size: 40,
                              bold: true,
                              color: "FF0000",
                              rightToLeft: true,
                            }),
                          ]
                        : []),
                    ],
                    alignment: AlignmentType.CENTER,
                    spacing: { ...noSpacing, line: 240 },
                    bidirectional: true,
                  }),
                ],
                verticalAlign: VerticalAlign.CENTER,
                columnSpan: 10,
                width: { size: tableWidth, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" },
                borders: {
                  top: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 24, color: "000000" },
                  bottom: headerBorder,
                  left: { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 24, color: "000000" },
                  right: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 24, color: "000000" },
                },
              }),
            ],
          });

          const headerRow = new TableRow({
            tableHeader: true,
            height: { value: 624, rule: "exact" },
            children: headers.map((header, index) =>
              makeCell(header, columnWidths[index], {
                font: "Sultan Bold",
                size: header === "المسمى الوظيفي" ? 18 : 28,
                bold: false,
                fill: "F2F2F2",
                borders: { top: headerBorder, bottom: headerBorder },
                line: 280,
              })
            ),
          });

          const bodyRows = options.rows.map((row) =>
            new TableRow({
              height: { value: 624, rule: "exact" },
              children: [
                makeCell(String(row.index ?? ""), columnWidths[0], { font: "Times New Roman", size: 24, bold: true, fill: "F2F2F2" }),
                makeCell(row.rank ? String(row.rank) : "", columnWidths[1]),
                makeCell(row.name ? String(row.name) : "", columnWidths[2]),
                makeCell(row.fileNumber ? String(row.fileNumber) : "", columnWidths[3], { font: "Times New Roman", size: 28, bold: true }),
                makeCell(row.nationalId ? String(row.nationalId) : "", columnWidths[4], { font: "Times New Roman", size: 28, bold: true }),
                makeCell(row.jobTitle ? String(row.jobTitle) : "-", columnWidths[5], { size: 30 }),
                makeCell(row.department ? String(row.department) : "", columnWidths[6], { size: 26 }),
                makeCell(row.attendance ? String(row.attendance) : "", columnWidths[7], { size: 20, bold: true, line: 280 }),
                makeCell(row.leave ? String(row.leave) : "", columnWidths[8], { size: 20, bold: true, line: 280 }),
                makeCell(row.notes ? String(row.notes) : "", columnWidths[9], { size: 20, bold: true, line: 280 }),
              ],
            })
          );

          const notesTitle = new Paragraph({
            children: [new TextRun({ text: "ملاحظات:", font: "Sultan Medium", size: 32, bold: false, rightToLeft: true })],
            style: "NoteText",
            alignment: AlignmentType.RIGHT,
            spacing: { before: 0, after: 0, line: 216 },
            bidirectional: true,
          });

          const editableNotes = (options.notes || [])
            .map((note) => String(note || "").trim())
            .filter(Boolean)
            .filter((note) => note.replace(/\s/g, "") !== "ملاحظات:");

          const fallbackNoteParagraphs = [
            new Paragraph({
              children: [
                  new TextRun({ text: "1- المناوبة تبدأ من الساعة ", font: "Sultan Medium", size: 28, rightToLeft: true }),
                  new TextRun({
                    text: "7:00",
                    font: "Times New Roman",
                    size: 30,
                    bold: true,
                    color: "0070C0",
                    rightToLeft: true,
                    shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFFF00" },
                }),
                new TextRun({ text: " مساءً إلى الساعة ", font: "Sultan Medium", size: 28, rightToLeft: true }),
                  new TextRun({
                    text: "12:00",
                    font: "Times New Roman",
                    size: 30,
                    bold: true,
                    color: "0070C0",
                    rightToLeft: true,
                    shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFFF00" },
                }),
                new TextRun({ text: " مساءً.", font: "Sultan Medium", size: 28, rightToLeft: true }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "2- على السادة قيادات المناوبات التأكيد على المناوبين قبل مواعيد مناوباتهم.",
                  font: "Sultan Medium",
                  size: 28,
                  color: "FF0000",
                  rightToLeft: true,
                }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "3- على مشرف المناوبة تدوين أية ملاحظات بدفتر الأحوال.",
                  font: "Sultan Medium",
                  size: 28,
                  color: "0070C0",
                  rightToLeft: true,
                }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "4- على القيادات والمشرفون المناوبين أن يكونوا على علم بأن يوم المناوبة كاملاً تحت مسئوليتهم وأن يكونوا على أتم الاستعداد عند طلبهم عن طريق الهاتف في أي وقت.",
                  font: "Sultan Medium",
                  size: 28,
                  color: "0070C0",
                  rightToLeft: true,
                }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "5- ضرورة الالتزام بالتعميم رقم (2020/8) بشأن منع التدخين داخل المبنى إلا في الأماكن المخصصة.",
                  font: "Sultan Medium",
                  size: 28,
                  color: "FF0000",
                  rightToLeft: true,
                  shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFFF00" },
                }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "6- على مشرف المناوبة أو من ينوب عنه ", font: "Sultan Medium", size: 28, rightToLeft: true }),
                new TextRun({
                  text: "(التأكد)",
                  font: "Sultan Medium",
                  size: 28,
                  rightToLeft: true,
                  shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFFF00" },
                }),
                new TextRun({
                  text: " من فاكس الإدارة العامة أثناء المناوبة بمكتب رقم (148) بالدور الأول.",
                  font: "Sultan Medium",
                  size: 28,
                  color: "FF0000",
                  rightToLeft: true,
                }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "7- على مشرف المناوبة التأكد من صيانة ونظافة دورية أو سيارة الجهة التابعة لمندوب المناوبة بناء على التعميم الداخلي رقم (2024/2) وتدوين أي ملاحظات في دفتر الأحوال.",
                  font: "Sultan Medium",
                  size: 28,
                  color: "00B050",
                  rightToLeft: true,
                }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "8- على السادة قيادات المناوبات متابعة موظفي دوام الفترة المسائية.",
                  font: "Sultan Medium",
                  size: 28,
                  color: "FF0000",
                  rightToLeft: true,
                }),
              ],
              style: "NoteText",
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0, line: 216 },
              bidirectional: true,
            }),
          ];

          const noteParagraphs = editableNotes.length > 0
            ? editableNotes.map((note, index) => {
              const color = index === 1 || index === 3 ? "FF0000" : index === 2 ? "0070C0" : index === 5 ? "00B050" : "666666";
              const highlighted = index === 0 || index === 3;
              return new Paragraph({
                children: makeArabicRunsWithTimesNumbers(note, {
                  color,
                  size: 28,
                  shading: highlighted ? "FFFF00" : undefined,
                }),
                style: "NoteText",
                alignment: AlignmentType.RIGHT,
                spacing: { before: 0, after: 0, line: 216 },
                bidirectional: true,
              });
            })
            : fallbackNoteParagraphs;

          const signatureLines = (options.manager || "")
            .split("\n")
            .filter(Boolean)
            .map((line, index) =>
              new Paragraph({
                children: [new TextRun({ text: line, font: "Sultan Bold", size: 36, color: "808080", bold: true, rightToLeft: true })],
                style: "SignatureText",
                spacing: { before: index === 0 ? 0 : 20, after: 0, line: 240 },
                bidirectional: true,
              })
            );

          const notesTable = new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: signatureLines,
                    verticalAlign: VerticalAlign.TOP,
                    borders: {
                      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    },
                    width: { size: 5000, type: WidthType.DXA },
                  }),
                  new TableCell({
                    children: [notesTitle, ...noteParagraphs],
                    verticalAlign: VerticalAlign.TOP,
                    borders: {
                      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    },
                    width: { size: 10728, type: WidthType.DXA },
                  }),
                ],
              }),
            ],
            width: { size: tableWidth, type: WidthType.DXA },
            columnWidths: [5000, 10728],
            layout: TableLayoutType.FIXED,
            alignment: AlignmentType.CENTER,
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
          });

          return [
            new Table({
              rows: [dateRow, headerRow, ...bodyRows],
              width: { size: tableWidth, type: WidthType.DXA },
              columnWidths,
              layout: TableLayoutType.FIXED,
              borders: outerBorders,
              alignment: AlignmentType.CENTER,
              visuallyRightToLeft: true,
            }),
            new Paragraph({ spacing: { before: 40, after: 0 } }),
            notesTable,
          ];
        })(),
      },
    ],
  });

  // حفظ الملف
  const buffer = await Packer.toBlob(doc);
  saveAs(buffer, `shifts-${Date.now()}.docx`);
}
