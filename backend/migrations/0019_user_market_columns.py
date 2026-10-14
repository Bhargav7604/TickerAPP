from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0018_secure_passwords_live_feed")]
    operations = [
        migrations.AddField(
            model_name="user",
            name="market_columns",
            field=models.JSONField(null=True, blank=True, default=None, editable=False),
        ),
    ]
