FROM eclipse-temurin:25-jre

WORKDIR /server

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN curl -o server.jar \
    "https://piston-data.mojang.com/v1/objects/97ccd4c0ed3f81bbb7bfacddd1090b0c56f9bc51/server.jar"
    
RUN curl -o fabric-installer.jar \
    "https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar"

RUN java -jar fabric-installer.jar server -mcversion 26.1.2 -downloadMinecraft

RUN echo "eula=true" > eula.txt

COPY server.properties .
COPY start.sh .
RUN chmod +x start.sh

EXPOSE 25565

CMD ["./start.sh"]