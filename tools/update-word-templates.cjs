const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');

async function updateTemplates() {
    // 1. Update template_soal_pengetahuan.docx
    const pPath = path.join(__dirname, '../apps/web/public/template_soal_pengetahuan.docx');
    const pZip = await JSZip.loadAsync(fs.readFileSync(pPath));
    let pXml = await pZip.file('word/document.xml').async('string');

    // Replace 'Kode' with 'Nomor Soal' in Petunjuk table
    if (pXml.includes('<w:t>Kode</w:t>')) {
        pXml = pXml.replace('<w:t>Kode</w:t>', '<w:t>Nomor Soal</w:t>');
        console.log('✓ Replaced "Kode" header with "Nomor Soal"');
    }

    // Update row 4 (4 -> 6) and row 5 (5 -> 8) in Petunjuk table
    const isiPetunjukIdx = pXml.indexOf('Isi Petunjuk');
    if (isiPetunjukIdx !== -1) {
        const tblStart = pXml.lastIndexOf('<w:tbl>', isiPetunjukIdx);
        const tblEnd = pXml.indexOf('</w:tbl>', isiPetunjukIdx) + 8;
        let petTableXml = pXml.substring(tblStart, tblEnd);

        const isianIdx = petTableXml.indexOf('Isian');
        if (isianIdx !== -1) {
            const fourIdx = petTableXml.lastIndexOf('<w:t>4</w:t>', isianIdx);
            if (fourIdx !== -1) {
                petTableXml = petTableXml.substring(0, fourIdx) + '<w:t>6</w:t>' + petTableXml.substring(fourIdx + '<w:t>4</w:t>'.length);
                console.log('✓ Mapped Petunjuk Isian to question number 6');
            }
        }

        const urutIdx = petTableXml.indexOf('Urutan');
        if (urutIdx !== -1) {
            const fiveIdx = petTableXml.lastIndexOf('<w:t>5</w:t>', urutIdx);
            if (fiveIdx !== -1) {
                petTableXml = petTableXml.substring(0, fiveIdx) + '<w:t>8</w:t>' + petTableXml.substring(fiveIdx + '<w:t>5</w:t>'.length);
                console.log('✓ Mapped Petunjuk Urutan to question number 8');
            }
        }

        pXml = pXml.substring(0, tblStart) + petTableXml + pXml.substring(tblEnd);
    }

    // Remove PANDUAN KUNCI JAWABAN block
    const pIndex = pXml.indexOf('PANDUAN KUNCI JAWABAN');
    if (pIndex !== -1) {
        const pParaStart = pXml.lastIndexOf('<w:p ', pIndex);
        const sectIndex = pXml.indexOf('<w:sectPr', pIndex);
        if (pParaStart !== -1 && sectIndex !== -1) {
            pXml = pXml.substring(0, pParaStart) + pXml.substring(sectIndex);
            console.log('✓ Removed PANDUAN KUNCI JAWABAN block');
        }
    }

    pZip.file('word/document.xml', pXml);
    const pBuf = await pZip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(pPath, pBuf);
    console.log('✓ Saved apps/web/public/template_soal_pengetahuan.docx');

    // 2. Update template_soal_kepribadian.docx
    const kPath = path.join(__dirname, '../apps/web/public/template_soal_kepribadian.docx');
    const kZip = await JSZip.loadAsync(fs.readFileSync(kPath));
    let kXml = await kZip.file('word/document.xml').async('string');

    const kPetStart = kXml.indexOf('TABEL PETUNJUK');
    if (kPetStart !== -1) {
        const kTblStart = kXml.indexOf('<w:tbl>', kPetStart);
        const kTblEnd = kXml.indexOf('</w:tbl>', kTblStart);
        let kTblXml = kXml.substring(kTblStart, kTblEnd);

        // Replace 1,2,3 with 1 for SJT
        if (kTblXml.includes('<w:t>1,2,3</w:t>')) {
            kTblXml = kTblXml.replace('<w:t>1,2,3</w:t>', '<w:t>1</w:t>');
            console.log('✓ SJT petunjuk mapped to 1');
        }
        // Replace 4 with 2,3 for Likert
        const likertIdx = kTblXml.indexOf('Likert');
        if (likertIdx !== -1) {
            const likert4Idx = kTblXml.lastIndexOf('<w:t>4</w:t>', likertIdx);
            if (likert4Idx !== -1) {
                kTblXml = kTblXml.substring(0, likert4Idx) + '<w:t>2,3</w:t>' + kTblXml.substring(likert4Idx + '<w:t>4</w:t>'.length);
                console.log('✓ Likert petunjuk mapped to 2,3');
            }
        }
        // Replace 5 with 4 for Forced-Choice
        const fcIdx = kTblXml.indexOf('Forced-Choice');
        if (fcIdx !== -1) {
            const fc5Idx = kTblXml.lastIndexOf('<w:t>5</w:t>', fcIdx);
            if (fc5Idx !== -1) {
                kTblXml = kTblXml.substring(0, fc5Idx) + '<w:t>4</w:t>' + kTblXml.substring(fc5Idx + '<w:t>5</w:t>'.length);
                console.log('✓ Forced-Choice petunjuk mapped to 4');
            }
        }
        // Replace 6 with 5 for Checklist
        const clIdx = kTblXml.indexOf('Checklist');
        if (clIdx !== -1) {
            const cl6Idx = kTblXml.lastIndexOf('<w:t>6</w:t>', clIdx);
            if (cl6Idx !== -1) {
                kTblXml = kTblXml.substring(0, cl6Idx) + '<w:t>5</w:t>' + kTblXml.substring(cl6Idx + '<w:t>6</w:t>'.length);
                console.log('✓ Checklist petunjuk mapped to 5');
            }
        }
        // Replace 7 with 6 for Ranking
        const rkIdx = kTblXml.indexOf('Ranking');
        if (rkIdx !== -1) {
            const rk7Idx = kTblXml.lastIndexOf('<w:t>7</w:t>', rkIdx);
            if (rk7Idx !== -1) {
                kTblXml = kTblXml.substring(0, rk7Idx) + '<w:t>6</w:t>' + kTblXml.substring(rk7Idx + '<w:t>7</w:t>'.length);
                console.log('✓ Ranking petunjuk mapped to 6');
            }
        }
        // For Paired Comparison, ensure exactly one 7 run
        const pcIdx = kTblXml.indexOf('Paired Comparison');
        if (pcIdx !== -1) {
            const pcRowStart = kTblXml.lastIndexOf('<w:tr ', pcIdx);
            const emptyParaMatch = kTblXml.indexOf('<w:p w14:paraId="29D28059"', pcRowStart);
            if (emptyParaMatch !== -1 && emptyParaMatch < pcIdx) {
                const paraClose = kTblXml.indexOf('</w:p>', emptyParaMatch);
                kTblXml = kTblXml.substring(0, emptyParaMatch) +
                    '<w:p w14:paraId="29D28059" w14:textId="043B27EE" w:rsidR="00094E56" w:rsidRDefault="00094E56">' +
                    '<w:pPr><w:jc w:val="center"/></w:pPr>' +
                    '<w:r><w:rPr><w:color w:val="1E293B"/></w:rPr><w:t>7</w:t></w:r>' +
                    kTblXml.substring(paraClose);
                console.log('✓ Paired Comparison petunjuk mapped to single 7');
            }
        }

        kXml = kXml.substring(0, kTblStart) + kTblXml + kXml.substring(kTblEnd);
        kZip.file('word/document.xml', kXml);
        const kBuf = await kZip.generateAsync({ type: 'nodebuffer' });
        fs.writeFileSync(kPath, kBuf);
        console.log('✓ Saved apps/web/public/template_soal_kepribadian.docx');
    }
}

updateTemplates().catch(err => {
    console.error('Error updating templates:', err);
    process.exit(1);
});
