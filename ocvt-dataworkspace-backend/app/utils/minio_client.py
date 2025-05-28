from minio import Minio
from minio.error import S3Error
import os
import io
from dotenv import load_dotenv

load_dotenv()

MINIO_BUCKET = os.getenv("MINIO_BUCKET", "ocvt")


class MinioClient:
    """Client pour interagir avec MinIO."""

    def __init__(self):
        print(os.getenv("MINIO_ENDPOINT", "localhost"))
        self.client = Minio(
            endpoint=f"{os.getenv("MINIO_ENDPOINT", "localhost")}:{os.getenv("MINIO_PORT", "9000")}",
            access_key=os.getenv("MINIO_ACCESS_KEY", ""),
            secret_key=os.getenv("MINIO_SECRET_KEY", ""),
            secure=os.getenv("MINIO_USE_SSL", "False").lower() == "true",
            region=os.getenv("MINIO_REGION", "us-east-1"),
        )

    def download_file(self, path: str) -> bytes:
        """
        Télécharge un fichier depuis MinIO.

        Args:
            path (str): Chemin du fichier dans le bucket.

        Returns:
            bytes: Contenu du fichier.

        Raises:
            S3Error: Si le fichier est introuvable ou l'accès est refusé.
        """
        response = None
        try:
            response = self.client.get_object(MINIO_BUCKET, path)
            return response.read()
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    def upload_file(self, path: str, data: bytes) -> None:
        """
        Téléverse un fichier vers MinIO.

        Args:
            path (str): Chemin du fichier dans le bucket.
            data (bytes): Contenu du fichier.

        Raises:
            S3Error: Si l'upload échoue.
        """
        self.client.put_object(MINIO_BUCKET, path, io.BytesIO(data), len(data))
