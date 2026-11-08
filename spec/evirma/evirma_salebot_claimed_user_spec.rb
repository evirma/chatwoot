require 'rails_helper'
require 'stringio'
require 'tmpdir'
require Rails.root.join('deploy/evirma/salebot/claimed_user').to_s

RSpec.describe EvirmaSalebotClaimedUser do
  let!(:account) { create(:account) }
  let(:user_id) { '0b8e1c2a-3f4d-4e5f-9a6b-7c8d9e0f1a2b' }
  let(:directory) { Dir.mktmpdir('salebot-claimed') }
  let(:links) { File.join(directory, 'links.csv') }

  before { stub_const('EvirmaSalebotClaimedUser::ACCOUNT_ID', account.id) }

  after { FileUtils.remove_entry(directory) }

  def write_links(rows)
    CSV.open(links, 'w') do |csv|
      csv << %w[chatwoot_contact_id evirma_user_id]
      rows.each { |row| csv << row }
    end
  end

  def run(apply:)
    described_class.new(links: links, apply: apply, output: StringIO.new).perform
  end

  it 'writes nothing in dry-run and sets only the claimed attribute on apply' do
    contact = create(:contact, account: account, identifier: nil)
    write_links([[contact.id, user_id.upcase]])

    expect(run(apply: false)).to eq('set' => 1)
    expect(contact.reload.custom_attributes).not_to have_key('claimed_evirma_user_id')

    run(apply: true)
    expect(contact.reload.custom_attributes['claimed_evirma_user_id']).to eq(user_id)
    expect(contact.identifier).to be_nil
  end

  it 'keeps a different existing claim and skips bad rows' do
    claimed = create(:contact, account: account, custom_attributes: { 'claimed_evirma_user_id' => 'other' })
    write_links([[claimed.id, user_id], [0, user_id], [claimed.id, 'not-a-uuid']])

    expect(run(apply: true)).to eq('skipped_other_claim' => 1, 'skipped_missing_contact' => 1, 'skipped_bad_user_id' => 1)
    expect(claimed.reload.custom_attributes['claimed_evirma_user_id']).to eq('other')
  end
end
