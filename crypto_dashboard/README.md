# Crypto transaction dashboard (Flask)

Do pages hain:

| Page | Kya dikhata hai |
|---|---|
| `/` (Monitor) | Koi transaction chuno aur dekho Spark ne uska kya kiya: model ka risk score, uske links, uska cluster, aur aas-paas ka network graph |
| `/results` (Slides) | Teeno stages ke results ki 6 slides (Spark SQL, MLlib, GraphX, Combined) |

Internet ki zaroorat nahi, charts, graph library aur fonts folder ke andar hi hain.

## Setup (ek baar)

1. **Naya `Main.scala`** (alag file mein diya hai) ko `crypto-wallet-project\src\main\scala\Main.scala` ki jagah rakho
   (purani file ka content delete karke naya paste karo).
2. Project folder mein `sbt run` chalao. Aakhir mein ye dikhna chahiye:

       >>> Saara result output/results.txt mein save ho gaya <<<
       >>> Dashboard ka data output/transactions.csv aur output/edges.csv mein save ho gaya <<<

   Model ke numbers pehle jaise hi aane chahiye (TP 710, FP 151, FN 197, TN 8066).
3. Is zip ko extract karo aur folder `crypto_dashboard` ko `crypto-wallet-project` ke **andar** rakho:

       crypto-wallet-project\
         build.sbt
         data\
         output\            <-- sbt run ke baad yahan transactions.csv, edges.csv, results.txt
         src\
         crypto_dashboard\  <-- ye

## Dashboard chalana

    cd C:\Users\AMIT\Desktop\crypto-wallet-project\crypto_dashboard
    pip install -r requirements.txt
    python app.py

Browser mein kholo: http://127.0.0.1:5000   (agar `pip` na mile: `python -m pip install flask`)

`sbt run` dobara chalane ke baad bas browser mein F5 dabao, naya data aa jayega.

## Presentation mein kya dikhana hai

1. **Monitor** kholo. Upar ke numbers aur 4-step strip batate hain ki pipeline ne kya kiya.
2. **Quick picks** mein "Unlabeled, flagged by model" dabao. Ye ek aisa transaction kholta hai jiska label nahi tha,
   lekin model ko illicit lagta hai. Graph mein uske links dikhte hain.
3. Graph ke kisi dot par click karo, wo transaction khul jayega.
4. **Clusters** tab: GraphX ne jo groups banaye, aur kaun se clusters mein sabse zyada illicit hain.
5. **Model scores** tab: model ne har transaction ko kitna risk diya, aur test results.
6. Aakhir mein **Results slides** par jaake findings aur limitations dikhao.

## Output folder kahan se padha jata hai

1. `OUTPUT_DIR` environment variable
2. `..\output` (jab folder project ke andar ho)
3. `.\output` (isi folder ke andar)

Agar `transactions.csv` nahi mili to Monitor page batata hai ki kya karna hai, aur Slides phir bhi chalti hain.
